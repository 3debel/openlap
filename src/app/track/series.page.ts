import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { Subscription, firstValueFrom } from 'rxjs';

import {
  CATEGORY_LABELS, CATEGORY_ORDER, Part, PartCategory, SERIES, Series, SeriesId,
  geometryLabel, partName, partNote, partsForSeries
} from './catalog';
import { Inventory, InventoryService } from './inventory.service';

interface Section {
  category: PartCategory;
  label: string;
  parts: Part[];
}

type Filter = 'all' | 'owned';

/** Teileliste einer Serie: Vorschau, Artikelnummer, Maße und Stückzahl je Teil. */
@Component({
  selector: 'series-page',
  templateUrl: 'series.page.html',
  styleUrls: ['series.page.scss'],
  standalone: false
})
export class SeriesPage implements OnDestroy {

  readonly series: Series;
  sections: Section[] = [];
  counts: { [id: string]: number } = {};
  filter: Filter = 'all';
  totalPieces = 0;
  lang: string;

  private readonly allParts: Part[];
  private subscription = new Subscription();

  constructor(
    route: ActivatedRoute,
    private inventory: InventoryService,
    private alert: AlertController,
    private translate: TranslateService)
  {
    const id = route.snapshot.paramMap.get('series') as SeriesId;
    this.series = SERIES.find(s => s.id === id) ?? SERIES[0];
    this.allParts = partsForSeries(this.series.id);
    this.lang = translate.currentLang || translate.getDefaultLang();
    this.subscription.add(translate.onLangChange.subscribe(e => {
      this.lang = e.lang;
    }));
    this.subscription.add(inventory.inventory.subscribe(inv => this.update(inv)));
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  setFilter(value: Filter) {
    this.filter = value;
    this.buildSections();
  }

  count(part: Part): number {
    return this.counts[part.id] ?? 0;
  }

  increment(part: Part) {
    this.inventory.setCount(part.id, this.count(part) + 1);
  }

  decrement(part: Part) {
    this.inventory.setCount(part.id, this.count(part) - 1);
  }

  /** Tipp auf die Zahl: Menge direkt eintippen (praktisch bei vielen Teilen). */
  async editCount(part: Part) {
    const header = await firstValueFrom(this.translate.get('Quantity'));
    const cancel = await firstValueFrom(this.translate.get('Cancel'));
    const save = await firstValueFrom(this.translate.get('Save'));
    const alert = await this.alert.create({
      header,
      subHeader: this.name(part),
      inputs: [{
        name: 'count',
        type: 'number',
        value: this.count(part),
        min: 0,
        max: 999,
        attributes: { inputmode: 'numeric', enterkeyhint: 'done' }
      }],
      buttons: [
        { text: cancel, role: 'cancel' },
        { text: save, handler: (data) => { this.inventory.setCount(part.id, Number(data.count)); } }
      ]
    });
    await alert.present();
  }

  name(part: Part): string {
    return partName(part, this.lang);
  }

  note(part: Part): string | undefined {
    return partNote(part, this.lang);
  }

  dimensions(part: Part): string | undefined {
    return geometryLabel(part.geometry);
  }

  trackById(_: number, part: Part) {
    return part.id;
  }

  trackBySection(_: number, section: Section) {
    return section.category;
  }

  private update(inv: Inventory) {
    this.counts = inv.counts;
    this.totalPieces = this.allParts.reduce((sum, p) => sum + (inv.counts[p.id] ?? 0), 0);
    this.buildSections();
  }

  private buildSections() {
    const visible = this.filter === 'owned'
      ? this.allParts.filter(p => this.count(p) > 0)
      : this.allParts;
    this.sections = CATEGORY_ORDER
      .map(category => ({
        category,
        label: CATEGORY_LABELS[category],
        parts: visible.filter(p => p.category === category),
      }))
      .filter(section => section.parts.length > 0);
  }
}
