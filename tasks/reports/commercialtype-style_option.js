let style_options = {}

export default class StyleOption{
  constructor(id, name, suffix, position, base_price_addition){
    this.id = parseInt(id);
    this.name = name;
    this.position = parseInt(position);
    this.suffix = suffix;
    this.base_price_addition = parseFloat(base_price_addition);
    style_options[this.id] = this;
  }

  static get(id){
    return style_options[parseInt(id)];
  }

  static forIds(ids){
    return ids.map((id) => style_options[parseInt(id)]).sort((a, b) => a.position - b.position);
  }

  static init(catalog){
    catalog.style_options.forEach((data) => new StyleOption(...data));
  }
};
