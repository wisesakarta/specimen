import Family from 'site/data/family'
import StyleOption from 'site/data/style_option'
import {markItemInCart, markItemNotInCart} from 'site/cart/base'
import {loadFont} from 'site/data/font_loader'
import {loaded} from 'site/data/base'
import {parse as parseOtf} from 'site/data/otf'
import {parse as parseTesterLanguages} from 'site/data/tester_languages'

let styles = {};

export default class Style{
  constructor(id, catalog_item_id, family, name, base_price, weight, italic_style, 
              italic_for, otf, languages, family_name, style_option_ids, position, layers, css_family_suffix){
    this.id = parseInt(id);
    this.catalog_item_id = parseInt(catalog_item_id);
    this.name = name;
    this.family = family;
    this.css_family_suffix = css_family_suffix;
    this.weight = weight ? parseInt(weight) : 400;
    this.family_name = (family ? family.name : family_name) || '';
    this.family_base_name = this.family_name.replace(/\s/g, '')
    this.url_name = name.toLowerCase().replace(/\s/g, '_');
    this.family_url_name = this.family_name.toLowerCase().replace(/\s/g, '_');
    this.base_price = parseFloat(base_price);
    this.position = parseInt(position);
    this._italic_for = parseInt(italic_for);
    this._italic_style = parseInt(italic_style);
    this._otf = otf;
    this._languages = languages;
    this.style_options = style_option_ids ? StyleOption.forIds(style_option_ids) : [];
    if (this.style_options.length == 0 && this.family) this.style_options = this.family.style_options;

    this.layers = layers == 0 ? false : layers;
   
    this.has_italic = this._italic_style > 0;
    this.italic = this._italic_for > 0;
    this.fontStyle = this.italic ? 'italic' : 'normal';
    this.full_name = `${this.family_name} ${this.name}`; 
    this.base_name = `${this.family_base_name}-${this.name.replace(/\s/g, '')}`; 
    if (this.family){
      this.family.addStyle(this);
      this.path = `${this.family.path}/${this.url_name}`;
      this.loose = false;
    } else {
      this.path = `/catalog/${this.family_url_name}/${this.url_name}`;
      this.loose = true;
    }
    this.packages = [];
    this.type = 'style';
    styles[id] = this;
  }

  layerFamilyName(layer){
    if (layer[0] == this.layers[0][0]){
      return this.css_family_name;
    } else {
      return `${this.css_family_name}${layer[0]}`;
    }
  }

  addPackage(pckage){
    this.packages.push(pckage)
  }

  get css_family_name(){
    // The dashes are because of a bug in Firefox where "Antique No 6" breaks FontFace and sets the family to blank
    // Any family name of the format "Foo Bar #" where # is a number breaks FontFace
    return `${this.family_name}${this.css_family_suffix}`.replace(/\s/g, '-');
  }

  fontFace(){
    if (this.layers){
      return this.layers.map((layer, i) => {
        return new FontFace(
          this.layerFamilyName(layer), 
          [`url("${this.fontPath(layer)}.woff2")`, `url("${this.fontPath(layer)}.woff")`], 
          {
            style: this.italic ? 'italic' : 'normal',
            weight: this.weight,
            stretch: 'normal'
          }
        )
      });
    } else {
      return [
        new FontFace(
          this.css_family_name, 
          [`url("${this.fontPath()}.woff2")`, `url("${this.fontPath()}.woff")`], 
          {
            style: this.italic ? 'italic' : 'normal',
            weight: this.weight,
            stretch: 'normal'
          }
        )
      ];
    }
  }

  markInCart(){
    markItemInCart('style', this.id);
  }

  markNotInCart(){
    markItemNotInCart('style', this.id);
  }

  async loadItalic(){
    if (this.italic_style){
      await loadFont(this.italic_style);
    }
    if (this.italic_for){
      await loadFont(this.italic_for);
    }
  }

  get cart_name(){
    return this.full_name;
  }

  get conjugate_style(){
    return this.italic_style || this.italic_for;
  }

  get italic_for(){
    if (this._italic_for > 0){
      return Style.get(this._italic_for);
    } else {
      return false;
    }
  }

  get italic_style(){
    if (this._italic_style > 0){
      return Style.get(this._italic_style);
    } else {
      return false;
    }
  }

  fontPath(layer){
    let suffix = '';
    if (layer != this.layers[0]){
      suffix = layer[0];
      if (suffix && suffix.trim().length > 0){
        suffix = `-${suffix.trim()}`;
      } else {
        suffix = '';
      }
    }
    let style_options_suffix = this.style_options.map((o) => o.suffix).join('-');
    if (style_options_suffix.length > 0) style_options_suffix = `-${style_options_suffix}`
    return `/webfonts/${this.family_name.toLowerCase().replace(/\s/g, '_')}/${this.base_name}${style_options_suffix}${suffix}-Web`;
  }

  get otf(){
    if (!this.parsed_otf){
      if (this._otf){
        this._otf = parseOtf(this._otf);
      } else {
        this._otf = [];
      }
      this.parsed_otf = true;
    }
    return this._otf;
  }

  get languages(){
    if (!this.parsed_languages){
      if (this._languages){
        this._languages = parseTesterLanguages(this._languages);
      } else {
        this._languages = this.family ? this.family.languages : [];
      }
      this.parsed_languages = true;
    }

    return this._languages;
  }

  get similar(){
    if (!this.parsed_similar){
      if (this.family){
        this._similar = this.parseSimilar();
      } else {
        this._similar = [];
      }
      this.parsed_similar = true;
    }

    return this._similar;
  }

  parseSimilar(){
    return this.family.similar_families.map((f) => Family.get(f).closest(this.weight, this.italic)).filter((s) => s != undefined);
  }

  styleElement(element){
    element.style.fontStyle = this.fontStyle;
    element.style.fontWeight = this.weight; 
    element.style.fontFamily = `"${this.css_family_name}"`;
    element.classList.add('font_loaded');
  }

  is(type){
    return type == this.type;
  }

  addToSearch(matches){
    if (this.catalog_item_id > 0){
      matches.push(this.catalog_item_id);
    }
    if (this.family){
      this.family.addToSearch(matches);
    }
  }

  static get plural(){
    return 'styles';
  }

  static get name(){
    return 'style';
  }

  static search(query){
    let matches = [];
    for (const [id, style] of Object.entries(styles)){
      if (style.loose && style.full_name.toLowerCase().match(query)){
        style.addToSearch(matches);
      }
    }
    return matches;
  }

  async loadAndSetStyle(element){
    try{
      await loadFont(this);
    } catch(error){
      console.log('Font failed to load.', error);
    }
    if (NodeList.prototype.isPrototypeOf(element)){
      element.forEach((e) => this.styleElement(e));
    } else {
      this.styleElement(element);
    }
  }

  get collection(){
    if (this.family){
      return this.family.collection;
    } else {
      return false;
    }
  }

  static async find(id, options){
    await loaded();
    
    return this.get(id);
  }

  static get(id){
    return styles[parseInt(id)];
  }

  static async create(source, data){
    return new Style(
      source[0], 
      source[1], 
      Family.get(source[2]), 
      data.names[source[3]], 
      data.prices[source[4]],
      data.weights[source[5]], 
      source[6],
      source[7],
      source[8],
      source[9],
      source[10],
      source[11],
      source[12],
      source[13],
      source[14]
    );
  }
};
