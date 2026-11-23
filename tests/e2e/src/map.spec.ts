import { expect, test } from '@playwright/test';
import { computeFrom, openWarsaw } from './support.ts';

test.describe('map (anonymous)', () => {
  test('address search, heatmap, legend, cell popup, shareable URL', async ({ page }) => {
    await openWarsaw(page);
    await expect(page.getByRole('region', { name: 'Legend' })).toContainText('Transit about as fast as a car');

    await computeFrom(page, 'Central Station', /Central Station/);
    await expect(page).toHaveURL(/city=waw&lat=52\.2002&lon=21\.0302/);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.getByText(/OpenStreetMap/).first()).toBeVisible();

    // The start cell is under the marker at the centre of the computed area; a click next to it
    // opens the popup of a cell.
    const map = page.locator('.map');
    // Click only once the cells are drawn; before that a click picks a new start point.
    await expect(map).toHaveAttribute('data-cells', 'ready');
    const box = await map.boundingBox();
    if (box === null) throw new Error('no map');
    await page.mouse.click(box.x + box.width / 2 + 25, box.y + box.height / 2 + 25);
    const popup = page.locator('.cell-popup');
    await expect(popup).toContainText('Public transport');
    await expect(popup).toContainText('Car');

    // The URL alone reproduces the map (from the calculation cache).
    await page.reload();
    await expect(page.locator('.status.done')).toContainText('from cache');
  });

  test('a start point outside the city is explained', async ({ page }) => {
    await page.goto('/?city=waw&lat=54.6872&lon=25.2797');
    await expect(page.locator('.status.error')).toContainText('outside the selected city');
    await expect(page.locator('.status.error')).toContainText('Reference:');
  });

  test('a city without a timetable says so', async ({ page }) => {
    await page.goto('/?city=vno');
    await expect(page.getByText('There is no timetable for Vilnius yet.')).toBeVisible();
  });
});
