let scripts;
let languages;

export function parse(unformatted_data){  
  if (!unformatted_data) return [];

  return unformatted_data.map((group) => {
    return [
      scripts[parseInt(group[0])],
      formattedItems(group[1])
    ]
  });
}

function formattedItems(items){
  return items.map((item) => { return languages[parseInt(item)] });
}

export function init(catalog){
  scripts = catalog.scripts;
  languages = catalog.languages;
};
