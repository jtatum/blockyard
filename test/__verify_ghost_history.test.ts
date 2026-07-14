import { describe, expect, it } from 'vitest';
import { generateGrid } from '../src/grid/generate';
import { Town } from '../src/town/town';
import { History } from '../src/town/history';

describe('new-town ghost history repro', () => {
  it('undo after clear resurrects removed block', () => {
    const grid = generateGrid({});
    const town = new Town(grid);
    town.seedIsland(13);
    const history = new History(town);

    // pick a land cell
    const cell = Array.from(town.terrain).findIndex((t) => t === 1);
    expect(cell).toBeGreaterThanOrEqual(0);

    // place a block, then remove it (two separate commands: click, right-click)
    history.commit([{ kind: 'voxel', cell, level: 0, after: 3 }]);
    expect(town.isFilled(cell, 0)).toBe(true);
    history.commit([{ kind: 'voxel', cell, level: 0, after: null }]);
    expect(town.isFilled(cell, 0)).toBe(false);

    // "New town" path mirrors main.ts onNew: town.clear, history untouched
    town.clear(13);
    expect(town.blockCount()).toBe(0);
    expect(history.canUndo).toBe(true); // stale stack survives

    // Cmd+Z: undo the *remove* command -> block resurrects on fresh island
    history.undo();
    console.log('resurrected after New town + undo:', town.isFilled(cell, 0), 'blockCount:', town.blockCount());
    expect(town.isFilled(cell, 0)).toBe(true);

    // second Cmd+Z undoes the *place*: visual no-op that feeds redo
    history.undo();
    expect(town.blockCount()).toBe(0);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(town.isFilled(cell, 0)).toBe(true); // redo also resurrects
  });
});
