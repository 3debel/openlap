import { Component, OnDestroy } from '@angular/core';

import { TranslateService } from '@ngx-translate/core';

import { Subscription } from 'rxjs';

import {
  AutoTrackOptions, DEFAULT_OPTIONS, Difficulty, Inventory, InventoryService, Layout, LayoutsService,
  Levels, PARTS, SavedLayout, generateLayouts, partName
} from '../track';

const LANE_CHANGE_IDS = ['20030343', '20030345', '20030347'];

interface MissingPart {
  name: string;
  articleNo: string | null;
  count: number;
}

interface Suggestion {
  layout: Layout;
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

  constructor(
    private inventoryService: InventoryService,
    private layouts: LayoutsService,
    translate: TranslateService)
  {
    this.lang = translate.currentLang || translate.getDefaultLang();
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
        maxResults: 3,
        timeBudgetMs: 3000,
        seed: Date.now(),
      }, f => this.progress = f);
      this.warnings = result.warnings;
      this.suggestions = result.layouts.map(layout => ({
        layout,
        missing: this.missingParts(layout),
        saved: false,
      }));
    } finally {
      this.running = false;
    }
  }

  async save(s: Suggestion) {
    await this.layouts.save(s.layout, { ...this.options });
    s.saved = true;
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
      const have = this.inventory.counts[id] ?? 0;
      if (n > have) {
        const part = PARTS.find(p => p.id === id)!;
        list.push({ name: partName(part, this.lang), articleNo: part.articleNo, count: n - have });
      }
    }
    return list;
  }
}
