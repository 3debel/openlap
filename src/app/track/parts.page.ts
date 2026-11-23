import { Component } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SERIES, Series } from './catalog';
import { InventoryService } from './inventory.service';

interface SeriesRow {
  series: Series;
  types: number;
  pieces: number;
}

/** Garage → Streckenteile: Serien mit Anzeige „Teile eingetragen“ und Pfeil zur Teileliste. */
@Component({
  selector: 'parts-page',
  templateUrl: 'parts.page.html',
  styleUrls: ['parts.page.scss'],
  standalone: false
})
export class PartsPage {

  readonly rows: Observable<SeriesRow[]>;

  constructor(private inventory: InventoryService) {
    this.rows = inventory.inventory.pipe(
      map(inv => SERIES.map(series => ({
        series,
        ...InventoryService.totalFor(inv, series.id),
      })))
    );
  }

}
