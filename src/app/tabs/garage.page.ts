import { Component } from '@angular/core';

import { ControlUnitService } from '../services';

@Component({
  selector: 'garage-page',
  templateUrl: 'garage.page.html',
  styleUrls: ['garage.page.scss'],
  standalone: false
})
export class GaragePage {
  constructor(public cu: ControlUnitService) {}
}
