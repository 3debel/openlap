import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { ControlUnitFigureComponent, ControlUnitSymbolComponent, EditorPage, LayoutViewComponent, PartIconComponent, PartsPage, SeriesPage } from '../track';

import { GaragePage } from './garage.page';
import { StatsPage } from './stats.page';
import { TabsPage } from './tabs.page';
import { TrackPage } from './track.page';

@NgModule({
  declarations: [
    EditorPage,
    GaragePage,
    ControlUnitFigureComponent,
    ControlUnitSymbolComponent,
    LayoutViewComponent,
    PartIconComponent,
    PartsPage,
    SeriesPage,
    StatsPage,
    TabsPage,
    TrackPage
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule,
    TranslateModule
  ]
})
export class TabsModule {}
