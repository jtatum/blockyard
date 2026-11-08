/**
 * URL share-code lifecycle (product P1/P3/P4). Boot restores a `#t=` share
 * code in preference to the autosave, so the code must not outlive the
 * first edit — otherwise a reload resurrects the old shared snapshot and the
 * next edit autosaves over the user's newer work. Headless: location/history
 * are stubbed with just what persistence.ts touches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropShareCodeOnChange, shareCodeFromUrl } from '../src/app/persistence';
import { generateGrid } from '../src/grid/generate';
import { Town } from '../src/town/town';

const grid = generateGrid();

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(13);
  return town;
}

/** minimal location + history whose replaceState really rewrites the URL */
function stubUrl(hash: string) {
  const location = { pathname: '/blockyard/', search: '?q=1', hash, origin: 'https://example.test' };
  const replaceState = vi.fn((_data: unknown, _unused: string, url: string) => {
    const i = url.indexOf('#');
    location.hash = i < 0 ? '' : url.slice(i);
  });
  vi.stubGlobal('location', location);
  vi.stubGlobal('window', { location, history: { replaceState } });
  return { location, replaceState };
}

function firstLandCell(town: Town): number {
  return grid.cells.find((c) => town.isLand(c.id))!.id;
}

describe('share code in the URL', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('is dropped by the first edit, so a reload restores the autosave instead', () => {
    const { location, replaceState } = stubUrl('#t=AbC_123-xyz');
    const town = freshTown();
    dropShareCodeOnChange(town);
    expect(shareCodeFromUrl()).toBe('AbC_123-xyz'); // registering alone changes nothing

    town.apply([{ kind: 'voxel', cell: firstLandCell(town), level: 0, after: 3 }]);

    expect(shareCodeFromUrl()).toBeNull();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/blockyard/?q=1');
    expect(location.hash).toBe('');
  });

  it('is dropped by a lighting-only change (time of day is part of the code)', () => {
    stubUrl('#t=sunset');
    const town = freshTown();
    dropShareCodeOnChange(town);
    town.timeOfDay = 0.8;
    town.notify(new Set()); // what applySun does
    expect(shareCodeFromUrl()).toBeNull();
  });

  it('a code written by the share button survives until the town next changes', () => {
    const { location, replaceState } = stubUrl('');
    const town = freshTown();
    dropShareCodeOnChange(town);
    const cell = firstLandCell(town);

    town.apply([{ kind: 'voxel', cell, level: 0, after: 1 }]);
    expect(replaceState).not.toHaveBeenCalled(); // no code, nothing to rewrite

    location.hash = '#t=justShared'; // onShare's replaceState
    expect(shareCodeFromUrl()).toBe('justShared');
    town.apply([{ kind: 'voxel', cell, level: 1, after: 2 }]);
    expect(shareCodeFromUrl()).toBeNull();
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
