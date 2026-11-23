import { Component } from '@angular/core';

import { addIcons } from 'ionicons';
import {
  add,
  arrowBackCircleOutline,
  arrowForwardCircleOutline,
  arrowUndo,
  bookmarkOutline,
  chevronBack,
  chevronDown,
  chevronUp,
  createOutline,
  magnet,
  repeat,
  swapHorizontal,
  trashOutline,
  carSport,
  checkmarkCircle,
  ellipseOutline,
  chevronForward,
  flag,
  grid,
  infinite,
  people,
  remove,
  settings,
  speedometer,
  statsChart,
} from 'ionicons/icons';

/**
 * Tab-Navigation im iOS-Stil: Garage, Strecke, Rennen, Statistik.
 *
 * Jeder Tab behält seinen eigenen Navigationsstapel. Ein laufendes
 * Rennen bleibt daher erhalten, wenn zwischendurch ein anderer Tab
 * geöffnet wird.
 */
@Component({
  selector: 'tabs-page',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false
})
export class TabsPage {
  constructor() {
    addIcons({ add, arrowBackCircleOutline, arrowForwardCircleOutline, arrowUndo, bookmarkOutline, chevronBack, chevronDown, chevronUp, createOutline, magnet, repeat, swapHorizontal, trashOutline, carSport, checkmarkCircle, chevronForward, ellipseOutline, flag, grid, infinite, people, remove, settings, speedometer, statsChart });
  }
}
