import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SettingsService } from '../services/settings.service';
import { Difficulty, Layout, Levels, TravelDirection } from './generator';
import { FeedSource, JointCondition } from './power';

export interface AutoTrackOptions {
  widthCm: number;
  depthCm: number;
  levels: Levels;
  minLaneChanges: number;
  difficulty: Difficulty;
  ownPartsOnly: boolean;
  /** WIRELESS+ Ladeschalen an der Bahn */
  chargingStations: number;
  /** Fahrtrichtung: rechtsherum, linksherum oder automatisch */
  direction: TravelDirection | 'auto';
  /** Stromquelle der Zusatzeinspeisung */
  feedSource: FeedSource;
  /** Abstand der Einspeisungen in mm */
  joints: JointCondition;
}

export const DEFAULT_OPTIONS: AutoTrackOptions = {
  widthCm: 300,
  depthCm: 150,
  levels: 1,
  minLaneChanges: 0,
  difficulty: 'medium',
  ownPartsOnly: true,
  chargingStations: 0,
  direction: 'auto',
  feedSource: 'internal',
  joints: 'new',
};

export interface SavedLayout {
  id: string;
  name: string;
  description: string;
  created: number;
  updated: number;
  options: AutoTrackOptions;
  layout: Layout;
}

const LAYOUTS = 'layouts';
const OPTIONS = 'autotrack-options';

/** Frühere Einstellwerte (z. B. fester Einspeiseabstand) auf gültige Werte bringen. */
function fixOptions(o: AutoTrackOptions): AutoTrackOptions {
  if (o.joints !== 'new' && o.joints !== 'used') o.joints = 'new';
  if (!['cw', 'ccw', 'auto'].includes(o.direction)) o.direction = 'auto';
  delete (o as { feedSpacing?: number }).feedSpacing;
  return o;
}

/** Ältere Einträge (ohne Name/Beschreibung) ergänzen. */
function migrate(l: Partial<SavedLayout>, i: number): SavedLayout {
  return {
    id: l.id ?? String(i),
    name: l.name ?? `Strecke ${i + 1}`,
    description: l.description ?? '',
    created: l.created ?? Date.now(),
    updated: l.updated ?? l.created ?? Date.now(),
    options: fixOptions({ ...DEFAULT_OPTIONS, ...(l.options ?? {}) }),
    layout: { chargingStations: 0, accessories: [], ...(l.layout as Layout) },
  };
}

/** Gespeicherte Strecken und zuletzt verwendete Optionen der automatischen Erstellung. */
@Injectable({
  providedIn: 'root'
})
export class LayoutsService {

  readonly layouts: Observable<SavedLayout[]>;
  readonly options: Observable<AutoTrackOptions>;

  private current: SavedLayout[] = [];

  constructor(private settings: SettingsService) {
    this.layouts = settings.observe(LAYOUTS).pipe(map(v => ((v as Partial<SavedLayout>[]) ?? []).map(migrate)));
    this.layouts.subscribe(list => this.current = list);
    this.options = settings.observe(OPTIONS).pipe(map(v => fixOptions({ ...DEFAULT_OPTIONS, ...(v ?? {}) })));
  }

  get(id: string): SavedLayout | undefined {
    return this.current.find(l => l.id === id);
  }

  /** Neue Strecke speichern; liefert die neue ID. */
  async save(layout: Layout, options: AutoTrackOptions, name: string, description: string): Promise<string> {
    const now = Date.now();
    const entry: SavedLayout = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim() || 'Strecke',
      description: description.trim(),
      created: now,
      updated: now,
      options,
      layout,
    };
    await this.settings.set(LAYOUTS, [entry, ...this.current]);
    return entry.id;
  }

  /** Bestehende Strecke überschreiben (Name, Beschreibung, Aufbau). */
  update(id: string, changes: Partial<Pick<SavedLayout, 'name' | 'description' | 'layout' | 'options'>>): Promise<void> {
    return this.settings.set(LAYOUTS, this.current.map(l => l.id === id ? { ...l, ...changes, updated: Date.now() } : l));
  }

  remove(id: string): Promise<void> {
    return this.settings.set(LAYOUTS, this.current.filter(l => l.id !== id));
  }

  saveOptions(options: AutoTrackOptions): Promise<void> {
    return this.settings.set(OPTIONS, options);
  }
}
