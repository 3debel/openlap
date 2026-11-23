import { Component, OnDestroy } from '@angular/core';

import { AlertController, NavController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { Subscription, firstValueFrom } from 'rxjs';

import { CATEGORY_LABELS, CATEGORY_ORDER, PARTS, Part, PartCategory, geometryLabel, partName } from './catalog';
import { Dir, Pose } from './geometry';
import { CONNECTION, CloseResult, Evaluation, Layout, Move, closeByStraights, evaluateMoves, layoutFromEvaluation, reverseMoves } from './generator';
import { Draft, EditorService } from './editor.service';
import { InventoryService } from './inventory.service';
import { LayoutsService } from './layouts.service';
import { PartsList, buildPartsList } from './parts-list';
import { FeedPoint, FeedSource, JointCondition, PowerPlan, MAX_CARS, MAX_DROP_SHARE, SUPPLY, TrackSystem, planPower } from './power';
import { AppSettings } from '../app-settings';

type PickerMode = 'replace' | 'insert-after' | 'insert-before';

interface PickerSection {
  label: string;
  parts: Part[];
}

/**
 * Strecke manuell anpassen: Teil antippen → ersetzen, davor/danach einfügen,
 * Kurvenrichtung tauschen, entfernen; „Automatisch schließen“ passt Geraden an.
 * Dazu Stromplan (Zusatzeinspeisung) und Teileliste; Speichern mit Name und Beschreibung.
 */
@Component({
  selector: 'editor-page',
  templateUrl: 'editor.page.html',
  styleUrls: ['editor.page.scss'],
  standalone: false
})
export class EditorPage implements OnDestroy {

  draft: Draft | null;
  evaluation: Evaluation | null = null;
  layout: Layout | null = null;
  power: PowerPlan | null = null;
  partsList: PartsList | null = null;
  problems: number[] = [];

  selected = 0;
  pickerOpen = false;
  pickerMode: PickerMode = 'replace';
  pickerSections: PickerSection[] = [];
  history: { moves: Move[]; start: Pose }[] = [];
  dirty = false;
  lang: string;
  openFeed: number | null = null;

  private inventory: Record<string, number> = {};
  private subscription = new Subscription();
  system: TrackSystem = 'digital132';

  constructor(
    editor: EditorService,
    private layouts: LayoutsService,
    private inventoryService: InventoryService,
    private alert: AlertController,
    private toast: ToastController,
    private nav: NavController,
    private translate: TranslateService,
    appSettings: AppSettings)
  {
    this.draft = editor.draft;
    this.subscription.add(appSettings.getOptions().subscribe(o => { this.system = o.system ?? 'digital132'; this.refresh(); }));
    this.lang = translate.currentLang || translate.getDefaultLang();
    this.subscription.add(translate.onLangChange.subscribe(e => { this.lang = e.lang; this.refresh(); }));
    this.subscription.add(inventoryService.inventory.subscribe(inv => { this.inventory = inv.counts; this.refresh(); }));
    this.pickerSections = CATEGORY_ORDER.map((c: PartCategory) => ({
      label: CATEGORY_LABELS[c],
      parts: PARTS.filter(p => p.category === c && p.geometry.kind !== 'unknown' && p.id !== CONNECTION),
    })).filter(s => s.parts.length);
    this.refresh();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  // ------------------------------------------------------------ Auswahl

  get moves(): Move[] {
    return this.draft?.moves ?? [];
  }

  get selectedPart(): Part | undefined {
    const m = this.moves[this.selected];
    return m ? PARTS.find(p => p.id === m.partId) : undefined;
  }

  get selectedIsCurve(): boolean {
    return this.selectedPart?.geometry.kind === 'curve';
  }

  get selectedIsStart(): boolean {
    return this.selected === 0;
  }

  select(i: number) {
    this.selected = i;
  }

  step(delta: number) {
    const n = this.moves.length;
    if (n) this.selected = (this.selected + delta + n) % n;
  }

  // ------------------------------------------------------------ Bearbeiten

  openPicker(mode: PickerMode) {
    this.pickerMode = mode;
    this.pickerOpen = true;
  }

  pick(part: Part) {
    if (!this.draft) return;
    const dir: Dir = part.geometry.kind === 'curve'
      ? (this.moves[this.selected]?.dir || 1) as Dir
      : 0;
    this.change(moves => {
      if (this.pickerMode === 'replace') {
        moves[this.selected] = { partId: part.id, dir };
      } else if (this.pickerMode === 'insert-after') {
        moves.splice(this.selected + 1, 0, { partId: part.id, dir });
        this.selected++;
      } else {
        moves.splice(Math.max(1, this.selected), 0, { partId: part.id, dir });
        if (this.selected === 0) this.selected = 1;
      }
    });
    this.pickerOpen = false;
  }

  flip() {
    if (!this.selectedIsCurve) return;
    this.change(moves => {
      const m = moves[this.selected];
      moves[this.selected] = { ...m, dir: (m.dir === 1 ? -1 : 1) as Dir };
    });
  }

  remove() {
    if (this.selectedIsStart || this.moves.length <= 3) return;
    this.change(moves => moves.splice(this.selected, 1));
    this.selected = Math.min(this.selected, this.moves.length - 1);
  }

  undo() {
    const prev = this.history.pop();
    if (!prev || !this.draft) return;
    this.draft.moves = prev.moves;
    this.draft.start = prev.start;
    this.selected = Math.min(this.selected, prev.moves.length - 1);
    this.refresh();
  }

  async autoClose() {
    if (!this.draft) return;
    const result = closeByStraights(this.moves, this.draft.start);
    if (result.ok === true) {
      const ok = result as Extract<CloseResult, { ok: true }>;
      this.change(moves => moves.splice(0, moves.length, ...ok.moves));
      await this.showToast('close_done', { n: ok.changedPieces });
      return;
    }
    const fail = result as Extract<CloseResult, { ok: false }>;
    if (fail.reason === 'heading') {
      await this.showToast('close_heading', { deg: Math.abs(fail.headingGap ?? 0) });
    } else {
      await this.showToast('close_no_solution');
    }
  }

  setFeedSource(v: FeedSource) {
    if (!this.draft) return;
    this.draft.options.feedSource = v;
    this.dirty = true;
    this.refresh();
  }

  /** Netzteildaten für Texte (Spannung, Leistung, Artikel, Rechenlast) */
  get supplyParams() {
    const sup = SUPPLY[this.system];
    const amps = Math.min(MAX_CARS * sup.ampsPerCar, sup.va / sup.volts);
    const f = (v: number, d = 1) => v.toLocaleString(this.lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: d });
    return {
      v: f(sup.volts), va: f(sup.va), art: this.system === 'digital124' ? '20020768' : '30326',
      sys: this.system === 'digital124' ? 'Digital 124' : 'Digital 132',
      cars: MAX_CARS, amps: f(amps), limit: f(sup.volts * MAX_DROP_SHARE, 2),
    };
  }

  volts(v: number) {
    return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  setJointCondition(v: JointCondition) {
    if (!this.draft) return;
    this.draft.options.joints = v;
    this.dirty = true;
    this.refresh();
  }

  toggleFeed(no: number) {
    this.openFeed = this.openFeed === no ? null : no;
  }

  // ------------------------------------------------------------ Speichern

  async save(asNew = false) {
    if (!this.draft || !this.layout) return;
    if (!this.draft.name.trim()) {
      const ok = await this.askName();
      if (!ok) return;
    }
    if (this.draft.id && !asNew) {
      await this.layouts.update(this.draft.id, {
        name: this.draft.name, description: this.draft.description, layout: this.layout, options: this.draft.options,
      });
    } else {
      this.draft.id = await this.layouts.save(this.layout, this.draft.options, this.draft.name, this.draft.description);
    }
    this.dirty = false;
    await this.showToast('saved_toast', { name: this.draft.name });
  }

  private async askName(): Promise<boolean> {
    const t = (k: string) => firstValueFrom(this.translate.get(k));
    const today = new Date().toLocaleDateString(this.lang);
    const alert = await this.alert.create({
      header: await t('Save track'),
      inputs: [
        { name: 'name', type: 'text', placeholder: await t('Name'), value: `${await t('Track')} ${today}` },
        { name: 'description', type: 'textarea', placeholder: await t('Description (optional)'), value: this.draft?.description ?? '' },
      ],
      buttons: [
        { text: await t('Cancel'), role: 'cancel' },
        { text: await t('Save'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm' || !this.draft) return false;
    this.draft.name = (data?.values?.name ?? '').trim() || `${await t('Track')} ${today}`;
    this.draft.description = (data?.values?.description ?? '').trim();
    return true;
  }

  markDirty() {
    this.dirty = true;
  }

  close() {
    this.nav.back();
  }

  // ------------------------------------------------------------ Anzeige

  name(part: Part | undefined): string {
    return part ? partName(part, this.lang) : '';
  }

  dims(part: Part | undefined): string {
    return part ? geometryLabel(part.geometry) ?? '' : '';
  }

  owned(part: Part): number {
    return this.inventory[part.id] ?? 0;
  }

  meters(mm: number): string {
    return (mm / 1000).toLocaleString(this.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  cableName(p: FeedPoint): string {
    return p.cable === 'feed10' ? '20020585 (10 m)' : p.cable === 'feed5' ? '20020584 (5 m)' : '–';
  }

  difficultyKey(): string {
    const d = this.evaluation?.difficulty ?? 'medium';
    return { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[d];
  }

  private change(fn: (moves: Move[]) => void) {
    if (!this.draft) return;
    this.remember();
    const next = this.draft.moves.map(m => ({ ...m }));
    fn(next);
    this.draft.moves = next;
    this.dirty = true;
    this.refresh();
  }

  private remember() {
    if (!this.draft) return;
    this.history.push({ moves: this.draft.moves.map(m => ({ ...m })), start: { ...this.draft.start } });
    if (this.history.length > 50) this.history.shift();
  }

  /** Gleiche Strecke in der anderen Richtung befahren; Control Unit bleibt Start/Ziel. */
  async reverseDirection() {
    if (!this.draft || !this.evaluation?.closed) return;
    this.remember();
    const r = reverseMoves(this.draft.moves, this.draft.start);
    this.draft.moves = r.moves;
    this.draft.start = r.start;
    this.selected = 0;
    this.dirty = true;
    this.refresh();
    await this.showToast(this.evaluation.direction === 'cw' ? 'reversed_cw' : 'reversed_ccw');
  }

  private refresh() {
    const d = this.draft;
    if (!d) return;
    const w = d.options.widthCm * 10, h = d.options.depthCm * 10;
    const e = evaluateMoves(d.moves, d.start, w, h, d.options.chargingStations);
    this.evaluation = e;
    this.layout = layoutFromEvaluation(e, w, h, d.options.chargingStations);
    this.power = e.closed ? planPower(e.pieces, d.options.feedSource, d.options.joints, this.system) : null;
    this.partsList = buildPartsList(this.layout, this.power, this.inventory, this.lang);
    this.problems = [...new Set(e.conflicts.filter(c => c.kind === 'overlap' && c.a >= 0).flatMap(c => [c.a, c.b]))];
  }

  private async showToast(key: string, params?: object) {
    const message = await firstValueFrom(this.translate.get(key, params));
    const t = await this.toast.create({ message, duration: 2200, position: 'bottom', cssClass: 'editor-toast' });
    await t.present();
  }
}
