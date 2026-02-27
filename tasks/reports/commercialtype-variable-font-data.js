import Collection from 'site/data/collection'
import Family from 'site/data/family'
import {markItemInCart, markItemNotInCart} from 'site/cart/base'
import {loaded} from 'site/data/base'
import {loadFont} from 'site/data/font_loader'
import {parse as parseAxes} from 'site/data/axes'
import {parse as parseOtf} from 'site/data/otf'
import {parse as parseTesterLanguages} from 'site/data/tester_languages'

let variable_fonts = {};

export default class VariableFont{
  constructor(id, catalog_item_id, collection, family, name, base_price, otf, languages, similar_families, style_options, 
              italic_for, italic_variable, axes, contained){
    this.id = parseInt(id);
    this.catalog_item_id = parseInt(catalog_item_id);
    this.name = name;
    this.full_name = `${name} Variable Font`;
    this.base_price = parseFloat(base_price);
    this.base_name = name.replace(/\s/g, '');
    this.url_name = name.toLowerCase().replace(/\s/g, '_');
    this.collection = collection;
    this.family = family;
    this.layers = false;
    this.contained = contained;
    this.family_name = this.name;
    if (this.family){
      this.collection = this.family.collection;
      this.family_name = this.family.name;
      this.family.addVariableFont(this);
    } else if (this.collection) {
      this.family_name = this.collection.name;
      this.collection.addVariableFont(this);
    }
    this.family_url_name = this.family_name.toLowerCase().replace(/\s/g, '_');

    this._italic_for = parseInt(italic_for);
    this._italic_variable = parseInt(italic_variable);
    this.italic = this._italic_for > 0;
    this.parent = this.collection || this.family;
    this.has_italic = this._italic_variable > 0;
    this.similar_families = similar_families;
    this.parent_path = this.parent ? `${this.parent.name.toLowerCase().replace(/\s/g, '_')}/` : '';
   
    if (axes.length > 0){
      this.axes = parseAxes(this.italic, axes);
    } else {
      this.axes = [];
    }
    if (this.parent){
      this.path = `${this.parent.path}/${this.url_name}`;
    } else {
      this.path = `/catalog/${this.url_name}`;
    }
    if (this.collection && this.contained.collection.length == 1 && this.contained.collection[0] == this.collection.id){
      this.equals_parent = this.collection;
    }
    if (this.family && this.contained.family.length == 1 && this.contained.family[0] == this.family.id){
      this.equals_parent = this.family;
    }

    this._otf = otf;
    this._languages = languages;
    this.style_options = style_options ? style_options : [];
    this.font_face_options = this.italic ? { style: 'italic' } : {};
    this.style_options_suffix = this.style_options.join('-');
    if (this.style_options_suffix.length > 0) this.style_options_suffix = `-${this.style_options_suffix}`;
    this.type = 'variable_font';
    variable_fonts[this.id] = this;
  }

  fontFace(path){
    return [new FontFace(this.name, `url("${path || `${this.font_path}.woff2`}") format('woff2-variations')`, this.font_face_options)];
  }
  
  is(type){
    return type == this.type;
  }

  markInCart(){
    markItemInCart('variable_font', this.id);
  }

  markNotInCart(){
    markItemNotInCart('variable_font', this.id);
  }

  get cart_name(){
    return this.full_name;
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
      if (this.similar_families){
        this._similar = this.parseSimilar(this.similar_families);
      } else if (this.family){
        this._similar = this.parseSimilar(this.family.similar_families);
      } else {
        this._similar = [];
      }
      this.parsed_similar = true;
    }

    return this._similar;
  }

  parseSimilar(similar_families){
    return similar_families.map((f) => Family.get(f).closest(this.weight, this.italic)).filter((s) => s != undefined);
  }

  addToSearch(matches){
    if (this.catalog_item_id > 0){
      matches.push(this.catalog_item_id);
    }
    if (this.collection){
      matches.push(this.collection.catalog_item_id)
    }
  }

  async loadItalic(){
    if (this.italic_variable){
      await loadFont(this.italic_variable);
    }
    if (this.italic_for){
      await loadFont(this.italic_for);
    }
  }

  get italic_for(){
    if (this._italic_for > 0){
      return VariableFont.get(this._italic_for);
    } else {
      return false;
    }
  }

  get italic_variable(){
    if (this._italic_variable > 0){
      return VariableFont.get(this._italic_variable);
    } else {
      return false;
    }
  }

  get font_path(){
    return `/webfonts/${this.parent_path}${this.base_name}${this.style_options_suffix}-VF-Web`;
  }

  static get plural(){
    return 'variable_fonts';
  }

  static get name(){
    return 'variable_font';
  }

  static async find(id){
    await loaded();

    return this.get(id);
  }

  static get(id){
    return variable_fonts[parseInt(id)];
  }

  static search(query){
    let matches = [];
    for (const [id, variable_font] of Object.entries(variable_fonts)){
      if (variable_font.name.toLowerCase().match(query)){
        variable_font.addToSearch(matches);
      }
    }
    return matches;
  }

  async loadAndSetStyle(element){
    await loadFont(this, element.dataset.fontFile);

    if (NodeList.prototype.isPrototypeOf(element)){
      element.forEach((e) => this.styleElement(e));
    } else {
      this.styleElement(element);
    }
  }

  axes_at(edge){
    return this.axes.map((axis) => `'${axis.tag}' ${axis[edge]}`).join(', ')
  }

  styleElement(element){
    element.style.fontFamily = `"${this.name}"`;
    element.style.fontStyle = this.italic ? 'italic' : '';
    let style_element = document.getElementById(`variable_animation_style_${this.id}`);
    if (!style_element){
      style_element = document.createElement('style');
      if (element.dataset.animate){
        style_element.innerHTML = `
          #variable_font_${this.id}{
            animation-duration: 6s;
            animation-delay: 0s;
            animation-iteration-count: infinite;
            animation-name: variable_font_${this.id}_animation;
            animation-timing-function: linear;
            font-variation-settings:${this.axes_at('min')};
          }
          @keyframes variable_font_${this.id}_animation{
            0% { font-variation-settings: ${this.axes_at('min')}; }         
            50% { font-variation-settings: ${this.axes_at('max')}; } 
            100% { font-variation-settings: ${this.axes_at('min')}; }
          }`
        document.querySelector('head').append(style_element);
      }
    }
    element.classList.add('font_loaded');
  }

  static create(source, data){
    return new VariableFont(
      source[0],
      source[1],
      Collection.get(source[2]),
      Family.get(source[3]),
      source[4],
      data.prices[source[5]],
      source[6],
      source[7],
      source[8],
      source[9],
      source[10],
      source[11],
      source[12],
      source[13]
    );
  }
};
