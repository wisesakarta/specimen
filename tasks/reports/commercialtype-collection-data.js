import {loaded} from 'site/data/base'
import {markItemInCart, markItemNotInCart} from 'site/cart/base'
import Style from 'site/data/style'
import StyleOption from 'site/data/style_option'

let collections = {};
const related_discount = 50;

export default class Collection{
  constructor(id, catalog_item_id, name, base_price, collection_styles, base_price_additions){
    this.id = parseInt(id);
    this.catalog_item_id = parseInt(catalog_item_id);
    this.name = name;
    this.full_name = `${this.name} Collection`;
    this.base_name = name.replace(/\s/g, '');
    this.url_name = name.toLowerCase().replace(/\s/g, '_')
    this.families = [];
    this.packages = [];
    this.variable_fonts = [];
    this.collection_styles = collection_styles;
    this.type = 'collection';
    this.path = `/catalog/${this.url_name}`;
    this.base_price = parseFloat(base_price);
    this.collection = this;
    this.parseBasePriceAdditions(base_price_additions);
    collections[this.id] = this;
  }

  parseBasePriceAdditions(base_price_additions){
    this.base_price_additions = base_price_additions;
    this.style_option_ids = [];
    for (const [id, multiplier] of Object.entries(base_price_additions)){
      this.style_option_ids.push(id);
      this.base_price_additions[id] = parseFloat(multiplier);
    }
  }
  
  addFamily(family){
    this.families.push(family);
  }

  addPackage(pckage){
    this.packages.push(pckage)
  }

  get cart_name(){
    if (this.variable_fonts.filter((variable_font) => variable_font.equals_parent == this).length > 0){
      return `${this.full_name} (includes variable font)`;
    } else {
      return this.full_name;
    }
  }

  get all_family_ids(){
    if (!this._all_family_ids){
      this._all_family_ids = new Set();
      this.families.forEach((family) => this._all_family_ids.add(family.id));
    }

    return this._all_family_ids;
  }

  get style_options(){
    if (!this._style_options){
      if (this.style_option_ids.length > 0){
        this._style_options = StyleOption.forIds(this.style_option_ids);
      } else {
        this._style_options = [];
        this.families.forEach((family) => {
          family.style_options.forEach((style_option) => {
            if (!this._style_options.includes(style_option)){
              this._style_options.push(style_option);
            }
          })
        });
      }
    } 

    return this._style_options;
  }

  markInCart(){
    markItemInCart('collection', this.id);
    this.families.forEach((family) => family.markInCart());
    this.collection_styles.forEach((style) => style.markInCart());
  }

  markNotInCart(){
    markItemNotInCart('collection', this.id);
    this.families.forEach((family) => family.markNotInCart());
    this.collection_styles.forEach((style) => style.markNotInCart());
  }

  addVariableFont(variable_font){
    this.variable_fonts.push(variable_font);
  }

  get savings(){
    if (!this._savings) this.calculateSavings();

    return this._savings;
  }

  calculateSavings(){
    let families_price = this.families.reduce((a, b) => a + b.base_price, 0);
    if (this.families.length > 1) families_price -= (this.families.length - 1) * related_discount; 
    
    this._savings = families_price - this.base_price;
  }
  
  is(type){
    return type == this.type;
  }

  static get plural(){
    return 'collections';
  }

  static get name(){
    return 'collection';
  }

  static async find(id, options){
    await loaded();

    return this.get(id);
  }

  static get(id){
    return collections[parseInt(id)];
  }

  static setCollectionStyles(){
    Object.keys(collections).forEach((id) => {
      collections[id].collection_styles = collections[id].collection_styles.map((style) => Style.get(style));
    });
  }

  static search(query){
    let matches = [];
    for (const [id, collection] of Object.entries(collections)){
      if (collection.name.toLowerCase().match(query) && collection.catalog_item_id > 0){
        matches.push(collection.catalog_item_id);
      }
    }
    return matches;
  }

  static create(source, data){
    return new Collection(
      source[0], 
      source[1],
      source[2], 
      data.prices[source[3]],
      source[4],
      source[5],
      source[6]
    );
  }
};
