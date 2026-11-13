import { routeVenueLabel } from './route-label';

describe('routeVenueLabel', () => {
  it('names Titan and Jupiter, including trigger orders', () => {
    expect(routeVenueLabel('titan:Titan-DART')).toBe('Titan');
    expect(routeVenueLabel('Titan')).toBe('Titan');
    expect(routeVenueLabel('jupiter')).toBe('Jupiter');
    expect(routeVenueLabel('jupiter-fallback')).toBe('Jupiter');
    expect(routeVenueLabel('jupiter-trigger')).toBe('Jupiter');
  });

  it('does not guess when the provider was not recorded or is not a swap venue', () => {
    expect(routeVenueLabel(null)).toBeUndefined();
    expect(routeVenueLabel(undefined)).toBeUndefined();
    expect(routeVenueLabel('')).toBeUndefined();
    expect(routeVenueLabel('   ')).toBeUndefined();
    expect(routeVenueLabel('oren-vault')).toBeUndefined();
  });
});
