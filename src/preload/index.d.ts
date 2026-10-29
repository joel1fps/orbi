import type { OrbiApi } from './index';

declare global {
  interface Window {
    orbi: OrbiApi;
  }
}
