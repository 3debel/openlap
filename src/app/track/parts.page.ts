import { Component } from '@angular/core';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SERIES, Series, SeriesId } from './catalog';
import { InventoryService } from './inventory.service';

interface SeriesRow {
  series: Series;
  selected: boolean;
  types: number;
  pieces: number;
}

/** Garage → Streckenteile: Serien mit Häkchen („besitze ich“) und Pfeil zur Teileliste. */
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
        selected: inv.series.includes(series.id),
        ...InventoryService.totalFor(inv, series.id),
      })))
    );
  }

  toggle(event: Event, id: SeriesId) {
    // Tipp auf das Häkchen soll nur umschalten, nicht die Teileliste öffnen
    event.preventDefault();
    event.stopPropagation();
    this.inventory.toggleSeries(id);
  }
}
