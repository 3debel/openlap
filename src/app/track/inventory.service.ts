import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { SettingsService } from '../services/settings.service';
import { PARTS, SeriesId } from './catalog';

/** Gespeicherter Bestand: gewählte Serien und Stückzahl je Teil. */
export interface Inventory {
  series: SeriesId[];
  counts: { [partId: string]: number };
}

const KEY = 'inventory';
const MAX_COUNT = 999;

const EMPTY: Inventory = { series: [], counts: {} };

@Injectable({
  providedIn: 'root'
})
export class InventoryService {

  readonly inventory: Observable<Inventory>;

  /** Aktueller Stand im Speicher – schnelles Mehrfachtippen verliert so keine Zählung. */
  private current: Inventory = EMPTY;

  constructor(private settings: SettingsService) {
    this.inventory = this.settings.observe(KEY).pipe(
      map((value: Inventory | undefined) => ({
        series: value?.series ?? EMPTY.series,
        counts: value?.counts ?? EMPTY.counts,
      })),
      shareReplay(1)
    );
    this.inventory.subscribe(inv => this.current = inv);
  }

  async toggleSeries(series: SeriesId): Promise<void> {
    const inv = this.current;
    const selected = inv.series.includes(series)
      ? inv.series.filter(s => s !== series)
      : [...inv.series, series];
    await this.save({ ...inv, series: selected });
  }

  async setCount(partId: string, count: number): Promise<void> {
    const inv = this.current;
    const value = Math.max(0, Math.min(MAX_COUNT, Math.round(count) || 0));
    const counts = { ...inv.counts };
    if (value === 0) {
      delete counts[partId];
    } else {
      counts[partId] = value;
    }
    await this.save({ ...inv, counts });
  }

  /** Summe aller Teile einer Serie (gemeinsame Teile zählen in beiden Serien). */
  static totalFor(inv: Inventory, series: SeriesId): { types: number; pieces: number } {
    let types = 0, pieces = 0;
    for (const part of PARTS) {
      const n = inv.counts[part.id] ?? 0;
      if (n > 0 && part.series.includes(series)) {
        types++;
        pieces += n;
      }
    }
    return { types, pieces };
  }

  private save(inv: Inventory): Promise<void> {
    this.current = inv;
    return this.settings.set(KEY, inv);
  }
}
