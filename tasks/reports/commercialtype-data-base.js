import axios from 'axios'
import License from 'site/cart/license'
import StyleOption from 'site/data/style_option'
import LicenseType from 'site/data/license_type'
import MultiScriptCollection from 'site/data/multi_script_collection'
import Collection from 'site/data/collection'
import Family from 'site/data/family'
import Style from 'site/data/style'
import VariableFont from 'site/data/variable_font'
import Package from 'site/data/package'
import Good from 'site/data/good'
import {loadFonts} from 'site/data/font_loader'
import {init as initAxes} from 'site/data/axes'
import {init as initOtf} from 'site/data/otf'
import {init as initTesterLanguages} from 'site/data/tester_languages'

let data_loaded_resolve;
let data_loaded;

export function loaded(){
  return data_loaded;
}

export async function init(){
  if (!data_loaded){
    data_loaded = new Promise((resolve, reject) => {
      data_loaded_resolve = resolve;
    });
    const response = await axios.get(`/json/${document.body.dataset.catalog}`);
    let catalog = response.data;
    
    StyleOption.init(catalog);
    LicenseType.init(catalog);
    initOtf(catalog);
    initAxes(catalog);
    initTesterLanguages(catalog);
    Good.init(catalog);
    License.init(catalog);

    catalog.collections.forEach((source) => Collection.create(source, catalog));
    catalog.multi_script_collections.forEach((source) => MultiScriptCollection.create(source, catalog));
    catalog.families.forEach((source) => Family.create(source, catalog));
    catalog.styles.forEach((source) => Style.create(source, catalog));
    catalog.variable_fonts.forEach((source) => VariableFont.create(source, catalog));
    catalog.packages.forEach((source) => Package.create(source, catalog));
    
    Collection.setCollectionStyles();
    Family.sortStyles();
    document.body.classList.add('data_loaded');
    enableDataDependentButtons();
    data_loaded_resolve(true);
  } else {
    document.body.classList.add('data_loaded');
    enableDataDependentButtons();
  }
  loadFonts();
}

export function enableDataDependentButtons(){
  document.querySelectorAll('button[data-wait]').forEach((e) => e.disabled = false);
}

export async function fontItem(source){
  let type = source.dataset ? source.dataset.type : source.type;
  let id = source.dataset ? source.dataset.id : source.id;
  let item;

  if (type == 'style'){
    item = await Style.find(id);
  } else {
    item = await VariableFont.find(id);
  }
  return item;
};
