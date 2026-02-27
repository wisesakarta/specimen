import Collection from 'site/data/collection'
import MultiScriptCollection from 'site/data/multi_script_collection'
import StyleOption from 'site/data/style_option'
import {markItemInCart, markItemNotInCart} from 'site/cart/base'
import {loaded} from 'site/data/base'
import {parse as parseTesterLanguages} from 'site/data/tester_languages'

let families = {};

export default class Family{      
  constructor(id, catalog_item_id, collection, multi_script_collection, name, base_price, languages, similar_families, style_option_ids, short_names){
    this.id = parseInt(id);
    this.catalog_item_id = parseInt(catalog_item_id);
    this.name = name;
    this.short_names = parseInt(short_names) == 1;
    this.full_name = `${name} Family`;
    this.base_price = parseFloat(base_price);
    this.base_name = name.replace(/\s/g, '');
    this.url_name = name.toLowerCase().replace(/\s/g, '_');
    this.collection = collection;
    this.family = this;
    this.similar_families = similar_families;
    this.languages = parseTesterLanguages(languages);
    this.styles = [];
    this.variable_fonts = [];
    this.packages = [];
    this.multi_script_collection = multi_script_collection;
    if (this.collection){
      this.collection.addFamily(this);
      
      this.path = `${this.collection.path}/${this.url_name}`;
    } else {
      this.path = `/catalog/${this.url_name}`;
    }
    this.style_options = style_option_ids ? StyleOption.forIds(style_option_ids) : [];
    this.type = 'family';
    families[this.id] = this;
  }
  
  addStyle(style){
    this.styles.push(style);
  }

  addPackage(pckage){
    this.packages.push(pckage)
    if (this.collection) this.collection.addPackage(pckage);
  }

  addVariableFont(variable_font){
    this.variable_fonts.push(variable_font);
  }

  is(type){
    return type == this.type;
  }

  get savings(){
    if (!this._savings) this.calculateSavings();

    return this._savings;
  }

  calculateSavings(){
    let styles_price = 0;
    this.styles.forEach((style) => {
      if (style.italic){
        styles_price += style.base_price * 0.5;
      } else {
        styles_price += style.base_price;
      }
    });
    this._savings = styles_price - this.base_price;
  }

  closest(weight, italic){
    let italic_d = 100000;
    let any_d = 100000;
    let italic_match;
    let any_match;

    this.styles.forEach((s) => {
      let d = Math.abs(weight - s.weight);
      if (s.italic == italic && d < italic_d){
        italic_d = d;
        italic_match = s;  
      }

      if (d < any_d){
        any_d = d;
        any_match = s;
      }
    });
    
    return italic_match ? italic_match : any_match;    
  }

  markInCart(){
    markItemInCart('family', this.id);
    this.styles.forEach((style) => style.markInCart());
  }

  markNotInCart(){
    markItemNotInCart('family', this.id);
    this.styles.forEach((style) => style.markNotInCart());
  }

  addToSearch(matches){
    if (this.catalog_item_id > 0){
      matches.push(this.catalog_item_id);
    }
    if (this.collection){
      matches.push(this.collection.catalog_item_id)
    }
  }

  get cart_name(){
    if (this.variable_fonts.filter((variable_font) => variable_font.equals_parent == this).length > 0){
      return `${this.full_name} (includes variable font)`;
    } else {
      return this.full_name;
    }
  }

  static get plural(){
    return 'families';
  }

  static get name(){
    return 'family';
  }

  static async find(id){
    await loaded();

    return this.get(id);
  }

  static get(id){
    return families[parseInt(id)];
  }

  static random(n){
    let p = 2 / Object.keys(families).length;
    let out = [];
    for (const [id, family] of Object.entries(families)){
      if (Math.random() < p){
        out.push(family);
        if (out.length == n){
          return out;
        }
      }
    }
    return out;
  }

  static search(query){
    let matches = [];
    for (const [id, family] of Object.entries(families)){
      if (family.name.toLowerCase().match(query)){
        family.addToSearch(matches);
      }
    }
    return matches;
  }

  static sortStyles(){
    Object.keys(families).forEach((id) => {
      families[id].styles = families[id].styles.sort((a, b) => a.position - b.position);
    });
  }

  static create(source, data){
    return new Family(
      source[0],
      source[1],
      Collection.get(source[2]),
      MultiScriptCollection.get(source[3]),
      source[4],
      data.prices[source[5]],
      source[6],
      source[7],
      source[8],
      source[9]
    );
  }
};
