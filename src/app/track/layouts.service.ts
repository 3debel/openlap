import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SettingsService } from '../services/settings.service';
import { Difficulty, Layout, Levels } from './generator';

export interface AutoTrackOptions {
  widthCm: number;
  depthCm: number;
  levels: Levels;
  minLaneChanges: number;
  difficulty: Difficulty;
  ownPartsOnly: boolean;
}

export const DEFAULT_OPTIONS: AutoTrackOptions = {
  widthCm: 300,
  depthCm: 150,
  levels: 1,
  minLaneChanges: 0,
  difficulty: 'medium',
  ownPartsOnly: true,
};

export interface SavedLayout {
  id: string;
  created: number;
  options: AutoTrackOptions;
  layout: Layout;
}

const LAYOUTS = 'layouts';
const OPTIONS = 'autotrack-options';

/** Gespeicherte Strecken und zuletzt verwendete Optionen der automatischen Erstellung. */
@Injectable({
  providedIn: 'root'
})
export class LayoutsService {

  readonly layouts: Observable<SavedLayout[]>;
  readonly options: Observable<AutoTrackOptions>;

  private current: SavedLayout[] = [];

  constructor(private settings: SettingsService) {
    this.layouts = settings.observe(LAYOUTS).pipe(map(v => (v as SavedLayout[]) ?? []));
    this.layouts.subscribe(list => this.current = list);
    this.options = settings.observe(OPTIONS).pipe(map(v => ({ ...DEFAULT_OPTIONS, ...(v ?? {}) })));
  }

  save(layout: Layout, options: AutoTrackOptions): Promise<void> {
    const entry: SavedLayout = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      created: Date.now(),
      options,
      layout,
    };
    return this.settings.set(LAYOUTS, [entry, ...this.current]);
  }

  remove(id: string): Promise<void> {
    return this.settings.set(LAYOUTS, this.current.filter(l => l.id !== id));
  }

  saveOptions(options: AutoTrackOptions): Promise<void> {
    return this.settings.set(OPTIONS, options);
  }
}
