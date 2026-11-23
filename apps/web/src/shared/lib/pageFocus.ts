// Focus after a route change: the router layer asks for it (requestPageFocus), the next page
// heading that mounts takes it (PageTitle). A flag rather than an effect on the location,
// because a lazy page mounts later than the navigation that opened it.
let pending = false;

export function requestPageFocus(): void {
  pending = true;
}

/** True once after requestPageFocus; the caller moves the focus. */
export function takePageFocus(): boolean {
  const wanted = pending;
  pending = false;
  return wanted;
}
