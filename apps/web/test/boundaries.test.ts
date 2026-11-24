// The layer and public-entry rule of the web client (apps/web/eslint/boundaries.js).
import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { boundaries } from '../eslint/boundaries.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const SRC = path.resolve(import.meta.dirname, '../src');
const at = (file: string) => path.join(SRC, file);
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('web/boundaries', boundaries, {
  valid: [
    // down the layers, through public entries
    { filename: at('app/router.tsx'), code: "import { x } from '../pages/MapPage.tsx';" },
    { filename: at('pages/MapPage.tsx'), code: "import { x } from '../features/map/index.ts';" },
    { filename: at('features/places/PlacesList.tsx'), code: "import { x } from '../cities/index.ts';" },
    { filename: at('features/map/MapState.tsx'), code: "import { x } from '../../shared/ui/index.ts';" },
    { filename: at('shared/api/client.ts'), code: "import type { x } from '../../models/types.ts';" },
    // inside one feature anything goes
    { filename: at('features/map/api/run.ts'), code: "import { x } from '../hexagons.ts';" },
    // a page test imports its page; lazy routes
    { filename: at('pages/HomePage.view.test.tsx'), code: "import { x } from './HomePage.tsx';" },
    { filename: at('app/router.tsx'), code: "const p = import('../pages/AdminPage.tsx');" },
    // packages are not checked
    { filename: at('shared/ui/Button.tsx'), code: "import { x } from 'react';" },
  ],
  invalid: [
    {
      filename: at('pages/PlacesPage.tsx'),
      code: "import { x } from '../features/places/api.ts';",
      errors: [{ messageId: 'entry' }],
    },
    {
      filename: at('features/history/HistoryList.tsx'),
      code: "import { x } from '../cities/CityFilter.tsx';",
      errors: [{ messageId: 'entry' }],
    },
    {
      filename: at('features/map/index.ts'),
      code: "export { x } from '../places/sort.ts';",
      errors: [{ messageId: 'entry' }],
    },
    {
      filename: at('app/CityLayout.tsx'),
      code: "const m = import('../features/map/MapView.tsx');",
      errors: [{ messageId: 'entry' }],
    },
    {
      filename: at('pages/SignInPage.tsx'),
      code: "import { x } from '../app/guards.tsx';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: at('shared/lib/validation.test.ts'),
      code: "import { x } from '../../features/auth/index.ts';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: at('features/places/PlacesList.tsx'),
      code: "import { x } from '../../pages/MapPage.tsx';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: at('pages/HistoryPage.tsx'),
      code: "import { x } from './PlacesPage.tsx';",
      errors: [{ messageId: 'page' }],
    },
  ],
});
