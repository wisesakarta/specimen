import Collection from 'site/data/collection'
import Family from 'site/data/family'
import Style from 'site/data/style'
import {markItemInCart} from 'site/cart/base'
import {loaded} from 'site/data/base'

let packages = {};

export default class Package{
  constructor(id, name, base_price, styles, families, collections){
    this.id = parseInt(id);
    this.name = name;
    this.full_name = `${this.name} Package`;
    this.base_name = name.replace(/\s/g, '');
    this.url_name = name.toLowerCase().replace(/\s/g, '_')
    this.styles = styles.map((s) => Style.get(s));
    this.type = 'package';
    this.base_price = parseFloat(base_price);
    this.processFamiliesAndCollections(families, collections);
    this.package = this;
    packages[this.id] = this;
  }

  childrenNames(){
    return this.collections.concat(this.families).concat(this.styles).map((f) => f.full_name).sort().join('<br>');
  }

  get all_family_ids(){
    if (!this._all_family_ids){
      this._all_family_ids = new Set();
      this.families.forEach((family) => this._all_family_ids.add(family.id));
      this.collections.forEach((collection) => collection.families.forEach((family) => this._all_family_ids.add(family.id)));
    }

    return this._all_family_ids;
  }

  processFamiliesAndCollections(families, collections){
    this.collections = [];
    collections.forEach((c) => { 
      let collection = Collection.get(c);
      if (collection){
        collection.addPackage(this);
        this.collections.push(collection);
      } else {
        console.log(`Missing collection ${c} for package ${this.id}`);
      }
    });

    this.families = [];
    families.forEach((f) => { 
      let family = Family.get(f);
      if (family){
        family.addPackage(this);
        this.families.push(family);
      } else {
        console.log(`Missing familiy ${f} for package ${this.id}`);
      }
    });
    this.styles.forEach((style) => style.addPackage(this));
  }

  hasFamily(family_id){
    return this.families.filter((family) => family.id == id ).length > 0;
  }

  markInCart(){
    this.styles.forEach((style) => style.markInCart());
    this.families.forEach((family) => family.markInCart());
    this.collections.forEach((collection) => collection.markInCart());
  }

  markNotInCart(){
    this.styles.forEach((style) => style.markNotInCart());
    this.families.forEach((family) => family.markNotInCart());
    this.collections.forEach((collection) => collection.markNotInCart());
  }
  
  is(type){
    return type == this.type;
  }
  
  get cart_name(){
    return this.full_name;
  }

  static get plural(){
    return 'packages';
  }

  static get name(){
    return 'package';
  }

  static async find(id, options){
    await loaded();

    return this.get(id);
  }

  static get(id){
    return packages[parseInt(id)];
  }

  static create(source, data){
    return new Package(
      source[0], 
      source[1],
      data.prices[source[2]],
      source[3], 
      source[4],
      source[5]
    );
  }
};
