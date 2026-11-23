import { Component, OnDestroy, OnInit } from '@angular/core';

import { Subscription } from 'rxjs';

import { AppSettings, Options } from '../app-settings';
import { I18nAlertService, SpeechService } from '../services';

@Component({
    templateUrl: 'settings.page.html',
    standalone: false
})
export class SettingsPage implements OnDestroy, OnInit {

  options = new Options();
  /** 6 Fahrer + Pace Car + Autonomous Car */
  carChoices = [1, 2, 3, 4, 5, 6, 7, 8];

  private subscription: Subscription;

  constructor(private alert: I18nAlertService, private settings: AppSettings, private speech: SpeechService) {}

  ngOnInit() {
    this.subscription = this.settings.getOptions().subscribe(options => {
      this.options = options;
    });
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  reset() {
    this.alert.show({
      message: 'Reset all user settings to default values?',
      buttons: [{
        text: 'Cancel',
        role: 'cancel',
      }, {
        text: 'OK',
        handler: () => { this.settings.clear(); }
      }]
    });
  }

  updateSystem() {
    return this.settings.setOptions(this.options);
  }

  async updateLanguage() {
    if (this.options.language) {
      let voices = await this.speech.getVoices(this.options.language);
      if (!voices.find(v => v.identifier == this.options.voice)) {
        this.options.voice = "";
      }
    } else {
      this.options.voice = "";
    }
    return this.settings.setOptions(this.options);
  }
}
