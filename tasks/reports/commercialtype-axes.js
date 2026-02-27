let axes;

export function parse(italic, unformatted_data){  
  if (!unformatted_data) return [];

  let parsed_axes = [];
  unformatted_data.forEach((id) => {
    let axis = axes[parseInt(id)];
    if ((axis.upright && !italic || !axis.upright) && 
        (axis.italic && italic || !axis.italic)){
      parsed_axes.push(axis);
    }
  })
  return parsed_axes;
}

export function init(catalog){
  axes = catalog.axes;
};
