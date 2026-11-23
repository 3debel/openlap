import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

import { RmsPage } from './rms';
import { DriversPage } from './drivers';
import { TuningPage } from './tuning';
import { GaragePage, StatsPage, TabsPage, TrackPage } from './tabs';
import { PartsPage, SeriesPage } from './track';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'tabs/race/practice',
    pathMatch: 'full'
  },
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      { path: 'garage', component: GaragePage },
      { path: 'garage/parts', component: PartsPage },
      { path: 'garage/parts/:series', component: SeriesPage },
      { path: 'garage/drivers', component: DriversPage },
      { path: 'garage/tuning', component: TuningPage },
      { path: 'track', component: TrackPage },
      { path: 'race', redirectTo: 'race/practice', pathMatch: 'full' },
      { path: 'race/:mode', component: RmsPage },
      { path: 'stats', component: StatsPage },
      { path: '', redirectTo: 'race/practice', pathMatch: 'full' }
    ]
  },
  {
    path: 'settings',
    loadChildren: () => import('./settings/settings.module').then(m => m.SettingsModule)
  },
  // alte Adressen von Open Lap weiterleiten
  { path: 'rms/:mode', redirectTo: 'tabs/race/:mode' },
  { path: 'drivers', redirectTo: 'tabs/garage/drivers' },
  { path: 'tuning', redirectTo: 'tabs/garage/tuning' },
  {
    path: '**',
    redirectTo: 'tabs/race/practice'
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: PreloadAllModules,
      useHash: true
    })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
