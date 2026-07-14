/**
 * Undo/redo command stack (product H1–H3). A command is the list of edits a
 * user action actually caused — single click, whole drag stroke, bulk fill,
 * or terrain edit — so one Ctrl+Z reverses exactly one gesture.
 */

import type { Edit, Town } from './town';

const MAX_DEPTH = 250;

export class History {
  private town: Town;
  private undoStack: Edit[][] = [];
  private redoStack: Edit[][] = [];
  /** edits accumulating during a drag stroke */
  private pending: Edit[] | null = null;

  constructor(town: Town) {
    this.town = town;
  }

  /** apply edits as one undoable command (or fold into the open stroke) */
  commit(edits: Edit[]): void {
    const real = this.town.apply(edits);
    if (real.length === 0) return;
    if (this.pending) {
      this.pending.push(...real);
    } else {
      this.push(real);
    }
  }

  beginStroke(): void {
    this.pending = [];
  }

  endStroke(): void {
    if (this.pending && this.pending.length > 0) this.push(this.pending);
    this.pending = null;
  }

  private push(edits: Edit[]): void {
    this.undoStack.push(edits);
    if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): boolean {
    const edits = this.undoStack.pop();
    if (!edits) return false;
    this.town.revert(edits);
    this.redoStack.push(edits);
    return true;
  }

  redo(): boolean {
    const edits = this.redoStack.pop();
    if (!edits) return false;
    this.town.reapply(edits);
    this.undoStack.push(edits);
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
