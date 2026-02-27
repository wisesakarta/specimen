import CommercialForm from 'site/interfaces/commercial_form'
import {insertAfter, createFromHTML} from 'gray_matter/utility/builder'
import axios from 'axios'

export default function init(){
  document.body.addEventListener('click', openTrial);
  document.querySelectorAll('#trial_downloads li a').forEach((e) => e.addEventListener('click', decreaseDownloadCount));
}

function decreaseDownloadCount(e){
  let item = this.closest('li');
  let count = item.querySelector('.trial_count');
  let n = parseInt(count.dataset.count);
  n = n - 1;
  if (n <= 0){
    n = 0;
    item.querySelector('a').remove();
  }
  count.dataset.count = n;
  count.innerHTML = `${n} remaining`;
}

export function closeAll(){
  document.querySelectorAll('.trial_interface').forEach((e) => e.remove());
}

async function openTrial(e){
  let button = e.target.closest('.open_trial');
  if (!button) return;

  if (this.nextElementSibling && this.nextElementSibling.classList.contains('trial_interface')) return;

  closeAll();
  let ids;
  if (button.getAttribute('id') == 'tester_trial'){
    ids = document.querySelector('#pin_tester .tester_interface').tester.blocks.map((block) => {
      return `${block.style.type}:${block.style.id}`;
    }).join(',');
  } else {
    ids = `${button.dataset.type}:${button.dataset.id}`; 
  }
  const response = await axios.get(`/trials/open/${ids}`);
  let trial_interface = createFromHTML(response.data);
  new CommercialForm(trial_interface, requestTrial, error, preSubmit);

  trial_interface.querySelector('.close_single_input').addEventListener('click', closeTrial);
  insertAfter(button, trial_interface);
  trial_interface.querySelector('input[name="trial[email]"]').focus();
}

function preSubmit(form){
  let selections = form.element.querySelectorAll('input[type="hidden"][name="catalog_item_ids[]"], input[type="checkbox"][name="catalog_item_ids[]"]:checked');
  if (selections.length == 0){
    form.showErrors({}, 'Please select fonts');
    return false;
  } else {
    return true;
  }
}

function closeTrial(){
  this.closest('.trial_interface').remove();
}

function requestTrial(response, form){
  form.element.querySelectorAll('.trial_fields, .trial_choices').forEach((e) => e.remove());
  form.element.querySelector('.trial_message').innerHTML = 'Thanks for your interest in our fonts. You will soon receive an email with a one time link to download a trial version of the requested fonts.'
  form.element.closest('.trial_interface').querySelector('.close_single_input').focus();
}

function error(respone, form){
  form.showErrors({}, 'We were not able to process your request.');
}
;
