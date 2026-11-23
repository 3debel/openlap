import { Component, OnDestroy } from '@angular/core';

import { AlertController, NavController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { Subscription, firstValueFrom } from 'rxjs';

import {
  AutoTrackOptions, DEFAULT_OPTIONS, Difficulty, EditorService, FeedSource, JointCondition, Inventory, InventoryService,
  Layout, LayoutsService, Levels, PARTS, PowerPlan, SavedLayout, TravelDirection, TrackSystem, CuEdge, SUPPLY, loadFor, buildPartsList, generateLayouts, partName, planPower
} from '../track';
import { AppSettings } from '../app-settings';

const LANE_CHANGE_IDS = ['20030343', '20030345', '20030347'];

interface MissingPart {
  name: string;
  articleNo: string | null;
  count: number;
}

interface Suggestion {
  layout: Layout;
  power: PowerPlan;
  missing: MissingPart[];
  saved: boolean;
}

/** Tab „Strecke“: automatische Streckenerstellung und gespeicherte Strecken. */
@Component({
  selector: 'track-page',
  templateUrl: 'track.page.html',
  styleUrls: ['track.page.scss'],
  standalone: false
})
export class TrackPage implements OnDestroy {

  options: AutoTrackOptions = { ...DEFAULT_OPTIONS };
  inventory: Inventory = { series: [], counts: {} };
  saved: SavedLayout[] = [];

  running = false;
  progress = 0;
  suggestions: Suggestion[] = [];
  warnings: string[] = [];
  searched = false;
  lang: string;

  readonly difficulties: Difficulty[] = ['easy', 'medium', 'hard'];
  readonly levelChoices: Levels[] = [1, 2, 3];

  private subscription = new Subscription();
  system: TrackSystem = 'digital132';
  cars = 4;

  constructor(
    private inventoryService: InventoryService,
    private layouts: LayoutsService,
    private editor: EditorService,
    private nav: NavController,
    private alert: AlertController,
    private translate: TranslateService,
    appSettings: AppSettings)
  {
    this.lang = translate.currentLang || translate.getDefaultLang();
    this.subscription.add(appSettings.getOptions().subscribe(o => {
      const changed = this.system !== o.system || this.cars !== o.cars;
      this.system = o.system ?? 'digital132';
      this.cars = o.cars ?? 4;
      if (changed) this.refreshPower();
    }));
    this.subscription.add(translate.onLangChange.subscribe(e => this.lang = e.lang));
    this.subscription.add(inventoryService.inventory.subscribe(inv => this.inventory = inv));
    this.subscription.add(layouts.layouts.subscribe(list => this.saved = list));
    this.subscription.add(layouts.options.subscribe(o => this.options = { ...o }));
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  get ownedPieces(): number {
    return Object.values(this.inventory.counts).reduce((a, b) => a + b, 0);
  }

  get availableLaneChanges(): number {
    if (!this.options.ownPartsOnly) return 20;
    return LANE_CHANGE_IDS.reduce((s, id) => s + (this.inventory.counts[id] ?? 0), 0);
  }

  get canGenerate(): boolean {
    return !this.running &&
      this.options.widthCm >= 80 && this.options.depthCm >= 60 &&
      (!this.options.ownPartsOnly || this.ownedPieces > 0);
  }

  setLevels(value: Levels) {
    this.options.levels = value;
    this.persist();
  }

  setDifficulty(value: Difficulty) {
    this.options.difficulty = value;
    this.persist();
  }

  changeChargers(delta: number) {
    this.options.chargingStations = Math.max(0, Math.min(6, (this.options.chargingStations ?? 0) + delta));
    this.persist();
  }

  setCuEdge(value: CuEdge) {
    this.options.cuEdge = value;
    this.persist();
  }

  setDirection(value: TravelDirection | 'auto') {
    this.options.direction = value;
    this.persist();
  }

  setFeedSource(value: FeedSource) {
    this.options.feedSource = value;
    this.refreshPower();
    this.persist();
  }

  /** Netzteildaten für Texte (Spannung, Leistung, Artikel, Rechenlast) */
  get supplyParams() {
    const sup = SUPPLY[this.system];
    const load = loadFor(this.system, this.cars);
    const f = (v: number, d = 1) => v.toLocaleString(this.lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: d });
    return {
      v: f(sup.volts), va: f(sup.va), art: this.system === 'digital124' ? '20020768' : '30326',
      sys: this.system === 'digital124' ? 'Digital 124' : 'Digital 132',
      cars: load.cars, amps: f(load.total), limit: f(load.maxDrop, 2),
    };
  }

  volts(v: number) {
    return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  setJointCondition(value: JointCondition) {
    this.options.joints = value;
    this.refreshPower();
    this.persist();
  }

  changeLaneChanges(delta: number) {
    const max = this.availableLaneChanges;
    this.options.minLaneChanges = Math.max(0, Math.min(max, this.options.minLaneChanges + delta));
    this.persist();
  }

  persist() {
    this.layouts.saveOptions({ ...this.options });
  }

  async generate() {
    if (!this.canGenerate) return;
    this.persist();
    this.running = true;
    this.progress = 0;
    this.searched = true;
    this.suggestions = [];
    this.warnings = [];
    try {
      const counts = this.buildCounts();
      const result = await generateLayouts({
        areaWidth: Math.round(this.options.widthCm * 10),
        areaDepth: Math.round(this.options.depthCm * 10),
        levels: this.options.levels,
        minLaneChanges: this.options.minLaneChanges,
        difficulty: this.options.difficulty,
        counts,
        chargingStations: this.options.chargingStations ?? 0,
        direction: this.options.direction ?? 'auto',
        cuEdge: this.options.cuEdge ?? 'front',
        maxResults: 3,
        timeBudgetMs: 3000,
        seed: Date.now(),
      }, f => this.progress = f);
      this.warnings = result.warnings;
      this.suggestions = result.layouts.map(layout => ({
        layout,
        power: planPower(layout.pieces, this.options.feedSource, this.options.joints, this.system, this.cars),
        missing: this.missingParts(layout),
        saved: false,
      }));
    } finally {
      this.running = false;
    }
  }

  /** Speichern mit Name und Beschreibung (Datum wird automatisch gesetzt). */
  async save(s: Suggestion) {
    const t = (k: string) => firstValueFrom(this.translate.get(k));
    const today = new Date().toLocaleDateString(this.lang);
    const alert = await this.alert.create({
      header: await t('Save track'),
      inputs: [
        { name: 'name', type: 'text', placeholder: await t('Name'), value: `${await t('Track')} ${today}` },
        { name: 'description', type: 'textarea', placeholder: await t('Description (optional)') },
      ],
      buttons: [
        { text: await t('Cancel'), role: 'cancel' },
        { text: await t('Save'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    const name = (data?.values?.name ?? '').trim() || `${await t('Track')} ${today}`;
    await this.layouts.save(s.layout, { ...this.options }, name, (data?.values?.description ?? '').trim());
    s.saved = true;
  }

  edit(s: Suggestion) {
    this.editor.open(s.layout, { ...this.options });
    this.nav.navigateForward('/tabs/track/edit');
  }

  openSaved(s: SavedLayout) {
    this.editor.open(s.layout, s.options, { id: s.id, name: s.name, description: s.description });
    this.nav.navigateForward('/tabs/track/edit');
  }

  missingCount(s: SavedLayout): number {
    return buildPartsList(s.layout, null, this.inventory.counts, this.lang).missingTotal;
  }

  private refreshPower() {
    for (const s of this.suggestions) {
      s.power = planPower(s.layout.pieces, this.options.feedSource, this.options.joints, this.system, this.cars);
    }
  }

  remove(id: string) {
    this.layouts.remove(id);
  }

  meters(mm: number): string {
    return (mm / 1000).toLocaleString(this.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  dateLabel(ts: number): string {
    return new Date(ts).toLocaleDateString(this.lang, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  difficultyKey(d: Difficulty): string {
    return { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[d];
  }

  trackSaved(_: number, s: SavedLayout) {
    return s.id;
  }

  private buildCounts(): Record<string, number> {
    if (this.options.ownPartsOnly) {
      return { ...this.inventory.counts };
    }
    const counts: Record<string, number> = {};
    for (const p of PARTS) {
      if (p.geometry.kind !== 'unknown') counts[p.id] = Infinity;
    }
    // ohne Digital-Serie keine Weichen vorschlagen, außer sie werden ausdrücklich verlangt
    if (!this.inventory.series.includes('digital132') && this.options.minLaneChanges === 0) {
      for (const id of LANE_CHANGE_IDS) delete counts[id];
    }
    return counts;
  }

  private missingParts(layout: Layout): MissingPart[] {
    const list: MissingPart[] = [];
    for (const [id, n] of Object.entries(layout.partCounts)) {
      const have = id === 'connection-straight' ? Math.max(1, this.inventory.counts[id] ?? 0) : (this.inventory.counts[id] ?? 0);
      if (n > have) {
        const part = PARTS.find(p => p.id === id)!;
        list.push({ name: partName(part, this.lang), articleNo: part.articleNo, count: n - have });
      }
    }
    return list;
  }
}
