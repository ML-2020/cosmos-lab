// Registry of cosmologies.  The order here is the order of the switcher.
import { FlatModel } from './flat.js';
import { GlobeModel } from './globe.js';
import { PtolemyModel } from './ptolemy.js';
import { HelioModel } from './helio.js';

export const MODEL_CLASSES = [FlatModel, GlobeModel, PtolemyModel, HelioModel];
