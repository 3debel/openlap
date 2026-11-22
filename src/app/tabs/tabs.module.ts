import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { GaragePage } from './garage.page';
import { StatsPage } from './stats.page';
import { TabsPage } from './tabs.page';
import { TrackPage } from './track.page';

@NgModule({
  declarations: [
    GaragePage,
    StatsPage,
    TabsPage,
    TrackPage
  ],
  imports: [
    CommonModule,
    IonicModule,
    RouterModule,
    TranslateModule
  ]
})
export class TabsModule {}
