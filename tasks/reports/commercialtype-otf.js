let otf_groups;

export function parse(unformatted_data){  
  if (!unformatted_data) return [];
  
  return unformatted_data.map((group) => {
    return [
      otf_groups[parseInt(group[0])],
      group[1]
    ]
  });
}

function formattedItems(items){
  return items.map((item) => { return languages[parseInt(item)] });
}

export function init(catalog){
  otf_groups = catalog.otf_groups;
};
