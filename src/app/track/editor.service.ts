import { Injectable } from '@angular/core';

import { Pose } from './geometry';
import { Layout, Move } from './generator';
import { AutoTrackOptions } from './layouts.service';

/** Arbeitskopie einer Strecke für den Editor. */
export interface Draft {
  /** gesetzt, wenn die Strecke schon gespeichert ist */
  id?: string;
  name: string;
  description: string;
  options: AutoTrackOptions;
  moves: Move[];
  start: Pose;
}

/** Übergibt eine Strecke an die Editor-Seite (Vorschlag oder gespeicherte Strecke). */
@Injectable({
  providedIn: 'root'
})
export class EditorService {

  draft: Draft | null = null;

  open(layout: Layout, options: AutoTrackOptions, saved?: { id: string; name: string; description: string }) {
    this.draft = {
      id: saved?.id,
      name: saved?.name ?? '',
      description: saved?.description ?? '',
      options: { ...options },
      moves: layout.pieces.map(p => ({ partId: p.partId, dir: p.dir })),
      start: { ...layout.pieces[0].start },
    };
  }
}
