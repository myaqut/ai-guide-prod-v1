// Content script for LeanIX AI Recommendations extension
// This script runs on LeanIX pages and extracts form field data

console.log('[LeanIX AI] Content script loaded');

// Debug mode - set to false for production
const DEBUG = false;
function log(...args) {
  if (DEBUG) console.log('[LeanIX AI]', ...args);
}

// Fields to ignore
const IGNORED_FIELDS = [
  'external id',
  'externalid',
  'external_id',
  'product id',
  'productid',
  'product_id',
];

// LeanIX custom select selectors (reusable)
const LX_SELECT_SELECTORS = 'lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select';
const LX_SELECT_CONTAINERS = '.selectContainer, .selectionContainer, .inputContainer';

// Store for currently focused/active field
let activeField = null;

// Check if field should be ignored
function shouldIgnoreField(fieldName, fieldId) {
  const nameLower = (fieldName || '').toLowerCase().trim();
  const idLower = (fieldId || '').toLowerCase().trim();
  
  return IGNORED_FIELDS.some(ignored => 
    nameLower.includes(ignored) || 
    idLower.includes(ignored) ||
    nameLower === ignored ||
    idLower === ignored
  );
}

// Safe element.matches wrapper
function safeMatches(element, selector) {
  try {
    return element && typeof element.matches === 'function' && element.matches(selector);
  } catch (e) {
    return false;
  }
}

// Check if element is an editable field (including Tiptap/ProseMirror and custom dropdowns)
function isEditableElement(element) {
  if (!element) return false;
  
  // Standard form elements and contenteditable
  if (safeMatches(element, 'input, textarea, select, [contenteditable="true"], .tiptap, .ProseMirror')) {
    return true;
  }
  
  // LeanIX custom select components
  if (safeMatches(element, LX_SELECT_SELECTORS + ', lx-dropdown-with-tree-view')) {
    return true;
  }
  
  // LeanIX select container and input elements
  if (safeMatches(element, LX_SELECT_CONTAINERS + ', .queryInput')) {
    return true;
  }
  
  // Check for data-field-name attribute (LeanIX specific)
  if (element.hasAttribute && (element.hasAttribute('data-field-name') || element.hasAttribute('data-field-target-selector'))) {
    return true;
  }
  
  // Custom dropdown/select components with specific attributes
  if (safeMatches(element, '[role="combobox"], [role="listbox"], [data-select]')) {
    return true;
  }
  
  // Check for aria attributes indicating a select-like element
  if (element.hasAttribute && (element.hasAttribute('aria-haspopup') || element.hasAttribute('aria-expanded'))) {
    return true;
  }
  
  return false;
}

// Find the editable element from a target (handles Tiptap containers and custom dropdowns)
function findEditableElement(element) {
  if (!element) return null;
  
  // Check for LeanIX custom select components first (bubble up from clicked element)
  const lxSelect = element.closest(LX_SELECT_SELECTORS);
  if (lxSelect) return lxSelect;
  
  // Check if we're inside a .selectContainer (LeanIX dropdown)
  const selectContainer = element.closest(LX_SELECT_CONTAINERS);
  if (selectContainer) {
    const parentSelect = selectContainer.closest(LX_SELECT_SELECTORS);
    if (parentSelect) return parentSelect;
    return selectContainer;
  }
  
  // Direct match
  if (isEditableElement(element)) {
    return element;
  }
  
  // Check for Tiptap/ProseMirror inside
  const tiptap = element.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
  if (tiptap) return tiptap;
  
  // Check for regular inputs including selects
  const input = element.querySelector('input, textarea, select');
  if (input) return input;
  
  // Check for LeanIX custom selects inside
  const lxSelectInside = element.querySelector(LX_SELECT_SELECTORS);
  if (lxSelectInside) return lxSelectInside;
  
  // Check for custom dropdown/select components
  const customSelect = element.querySelector('[role="combobox"], [role="listbox"], [data-select]');
  if (customSelect) return customSelect;
  
  // Check parent elements for field containers
  const parentField = element.closest('[data-field-id], [data-field-name], .field-container');
  if (parentField) {
    const nestedLxSelect = parentField.querySelector(LX_SELECT_SELECTORS);
    if (nestedLxSelect) return nestedLxSelect;
    
    const nestedTiptap = parentField.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
    if (nestedTiptap) return nestedTiptap;
    
    const nestedInput = parentField.querySelector('input, textarea, select');
    if (nestedInput) return nestedInput;
  }
  
  return null;
}

// Notify popup about active field change
function notifyActiveFieldChange(fieldData) {
  if (!fieldData || shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
    return false;
  }
  
  activeField = fieldData;
  log('Active field set:', activeField.fieldName, activeField.fieldId);
  
  try {
    chrome.runtime.sendMessage({
      action: 'activeFieldChanged',
      field: activeField
    });
    return true;
  } catch (e) {
    log('Could not send message to popup');
    return false;
  }
}

// Listen for focus events on input fields
document.addEventListener('focusin', (event) => {
  const element = event.target;
  log('Focusin event on:', element.tagName, element.className);
  
  const targetElement = findEditableElement(element);
  
  if (targetElement && isEditableElement(targetElement)) {
    const fieldData = extractFieldData(targetElement);
    log('Extracted field data:', fieldData);
    notifyActiveFieldChange(fieldData);
  }
}, true);

// Listen for click events specifically for LeanIX custom select components
document.addEventListener('click', (event) => {
  const element = event.target;
  
  log('Click on element:', element.tagName, element.className?.substring?.(0, 50));
  
  // Find LeanIX select component - prioritize lx-relating-fact-sheet-select with data-field-name
  let lxSelect = element.closest('lx-relating-fact-sheet-select[data-field-name]');
  
  // If not found, check inner components and traverse up
  if (!lxSelect) {
    const innerSelect = element.closest(LX_SELECT_SELECTORS);
    if (innerSelect) {
      lxSelect = innerSelect.closest('lx-relating-fact-sheet-select[data-field-name]') || innerSelect;
    }
  }
  
  // Check for selectContainer clicks
  if (!lxSelect) {
    const selectContainer = element.closest(LX_SELECT_CONTAINERS);
    if (selectContainer) {
      lxSelect = selectContainer.closest('lx-relating-fact-sheet-select[data-field-name]');
    }
  }
  
  if (lxSelect) {
    const fieldName = lxSelect.getAttribute('data-field-name');
    log('Click detected on LeanIX select, field-name:', fieldName);
    
    if (fieldName) {
      const fieldData = extractFieldData(lxSelect);
      log('LX Select field data:', fieldData);
      
      if (notifyActiveFieldChange(fieldData)) {
        return; // Don't continue with other click handlers
      }
    }
  }
  
  // Check if clicked on a label or field container
  const label = element.closest('label');
  if (label) {
    const forId = label.getAttribute('for');
    if (forId) {
      const input = document.getElementById(forId);
      if (input) {
        const fieldData = extractFieldData(input, label.textContent);
        notifyActiveFieldChange(fieldData);
      }
    }
  }
}, true);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('Received message:', request.action);
  
  if (request.action === 'getPageData') {
    const pageData = extractPageData();
    log('Extracted page data:', pageData.fields?.length, 'fields');
    sendResponse(pageData);
  } else if (request.action === 'getNameField') {
    const nameField = findNameField();
    const pageTitle = document.querySelector('h1, .page-title, [data-testid="factsheet-title"]')?.textContent?.trim() || 
                      document.title || 
                      'LeanIX Page';
    log('Returning Name field:', nameField?.currentValue);
    sendResponse({ field: nameField, pageContext: pageTitle });
  } else if (request.action === 'getActiveField') {
    log('Returning active field:', activeField?.fieldName);
    sendResponse({ field: activeField });
  } else if (request.action === 'applyRecommendation') {
    const result = applyFieldValue(request.fieldId, request.value);
    log('Apply result:', result.success);
    sendResponse(result);
  }
  
  return true; // Keep the message channel open for async response
});

// Find the Name field on the page - searches FRESH each time
function findNameField() {
  log('Searching for Name field...');
  
  // First, try to find by label text "Name" and get associated input
  const allLabels = document.querySelectorAll('label');
  for (const label of allLabels) {
    const labelText = label.textContent?.trim().replace(/\s*\*\s*$/, '').toLowerCase();
    if (labelText === 'name') {
      log('Found Name label');
      
      // Try 'for' attribute
      const forId = label.getAttribute('for');
      if (forId) {
        const input = document.getElementById(forId);
        if (input) {
          log('Found input by for attribute:', input.value);
          return extractFieldData(input, 'Name');
        }
      }
      
      // Try sibling input
      const parent = label.parentElement;
      if (parent) {
        const input = parent.querySelector('input[type="text"], input:not([type]), textarea');
        if (input) {
          log('Found input as sibling:', input.value);
          return extractFieldData(input, 'Name');
        }
      }
      
      // Try nested input
      const nestedInput = label.querySelector('input, textarea');
      if (nestedInput) {
        log('Found nested input:', nestedInput.value);
        return extractFieldData(nestedInput, 'Name');
      }
      
      // Try next sibling element
      const nextElement = label.nextElementSibling;
      if (nextElement) {
        const input = safeMatches(nextElement, 'input, textarea') ? nextElement : nextElement.querySelector('input, textarea');
        if (input) {
          log('Found input in next sibling:', input.value);
          return extractFieldData(input, 'Name');
        }
      }
    }
  }
  
  // Try various selectors to find the Name field
  const nameSelectors = [
    '[data-field-id="name"]',
    '[data-field-name="name"]',
    '[name="name"]',
    '#name',
    'input[placeholder*="name" i]',
    '[data-testid*="name"]',
  ];
  
  for (const selector of nameSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const fieldData = extractFieldData(element, 'Name');
        if (fieldData) {
          log('Found Name by selector:', selector, fieldData.currentValue);
          return fieldData;
        }
      }
    } catch (e) {
      // Continue to next selector
    }
  }
  
  // Last resort: find any text input that might be the name
  const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
  for (const input of allInputs) {
    const fieldData = extractFieldData(input);
    if (fieldData && fieldData.fieldName.toLowerCase() === 'name') {
      log('Found Name by input scan:', fieldData.currentValue);
      return fieldData;
    }
  }
  
  log('Name field not found');
  return null;
}

// Extract all form fields from the page
function extractPageData() {
  const pageTitle = document.querySelector('h1, .page-title, [data-testid="factsheet-title"]')?.textContent?.trim() || 
                    document.title || 
                    'LeanIX Page';
  
  const fields = [];
  const processedIds = new Set();
  
  // Common LeanIX field selectors - including provider and select/dropdown fields
  const fieldSelectors = [
    // LeanIX custom select components (Angular)
    'lx-relating-fact-sheet-select[data-field-name]',
    'lx-single-select',
    'lx-fact-sheet-select',
    // Tiptap/ProseMirror editors (for description fields)
    '.tiptap',
    '.ProseMirror',
    '[contenteditable="true"]',
    // Standard input fields
    'input[data-field-id]',
    'textarea[data-field-id]',
    'select[data-field-id]',
    // Custom dropdown/select components
    '[role="combobox"]',
    '[role="listbox"]',
    '[data-select]',
    // LeanIX specific selectors
    '[data-testid*="field"]',
    '[class*="field-input"]',
    '[class*="FieldInput"]',
    // Select/dropdown patterns
    '[class*="select" i][data-field-id]',
    '[class*="dropdown" i][data-field-id]',
    '[class*="picker" i][data-field-id]',
    // Provider field specific selectors
    '[data-field-id="provider"]',
    '[data-field-name="provider"]',
    '[name="provider"]',
    'input[placeholder*="provider" i]',
    '[class*="provider" i] input',
    '[class*="provider" i] select',
    // Name field
    '[data-field-id="name"]',
    '[name="name"]',
    // Description field  
    '[data-field-id="description"]',
    '[name="description"]',
    // Form inputs with name attributes
    'input[name]',
    'textarea[name]',
    'select[name]',
    // Native select elements
    'select',
  ];
  
  fieldSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(element => {
        const fieldData = extractFieldData(element);
        if (fieldData && !processedIds.has(fieldData.fieldId)) {
          if (shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
            log('Ignoring field:', fieldData.fieldName);
            return;
          }
          processedIds.add(fieldData.fieldId);
          fields.push(fieldData);
        }
      });
    } catch (e) {
      // Continue to next selector
    }
  });
  
  // Also try to find fields by looking at labels
  document.querySelectorAll('label').forEach(label => {
    const forId = label.getAttribute('for');
    if (forId) {
      const input = document.getElementById(forId);
      if (input) {
        const fieldData = extractFieldData(input, label.textContent);
        if (fieldData && !processedIds.has(fieldData.fieldId)) {
          if (shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
            log('Ignoring field:', fieldData.fieldName);
            return;
          }
          processedIds.add(fieldData.fieldId);
          fields.push(fieldData);
        }
      }
    }
  });
  
  // If there's an active field, make sure it's included
  if (activeField && !processedIds.has(activeField.fieldId)) {
    if (!shouldIgnoreField(activeField.fieldName, activeField.fieldId)) {
      fields.unshift(activeField);
    }
  }
  
  return {
    pageContext: pageTitle,
    fields: fields.slice(0, 20),
    activeField: activeField
  };
}

// Extract data from a single field element
function extractFieldData(element, labelTextParam = '') {
  if (!element) return null;
  
  // Skip hidden elements
  if (element.type === 'hidden') return null;
  
  // Check for LeanIX custom select components (Angular)
  const isLxSelect = safeMatches(element, LX_SELECT_SELECTORS);
  
  // Check for Tiptap/ProseMirror - look for fieldId on parent container
  const isTiptap = safeMatches(element, '.tiptap, .ProseMirror') || element.getAttribute?.('contenteditable') === 'true';
  
  let fieldId = element.getAttribute?.('data-field-id') ||
                element.getAttribute?.('data-field-name') ||
                element.getAttribute?.('name') ||
                element.getAttribute?.('id') ||
                element.getAttribute?.('data-testid') ||
                '';
  
  // For LeanIX custom selects, extract from data-field-name
  if (isLxSelect && !fieldId) {
    fieldId = element.getAttribute?.('data-field-name') || '';
    log('LX Select field detected:', fieldId);
  }
  
  // For Tiptap editors, try to find fieldId from parent elements
  if (!fieldId && isTiptap) {
    const parent = element.closest('[data-field-id], [data-field-name]');
    if (parent) {
      fieldId = parent.getAttribute('data-field-id') ||
                parent.getAttribute('data-field-name') ||
                parent.getAttribute('id') ||
                '';
      
      // Check if parent class contains "description"
      if (!fieldId && parent.className?.toLowerCase?.().includes('description')) {
        fieldId = 'description';
      }
    }
    
    // Only use description as fallback if we can confirm it's actually a description field
    if (!fieldId) {
      const container = element.closest('.form-group, .field-container');
      if (container) {
        const labelEl = container.querySelector('label, .label');
        const foundLabelText = labelEl?.textContent?.toLowerCase()?.trim() || '';
        if (foundLabelText.includes('description')) {
          fieldId = 'description';
        }
      }
    }
    
    // If still no fieldId, skip this element
    if (!fieldId) {
      return null;
    }
  }
  
  if (!fieldId) return null;
  
  // Get field name from labelText parameter or find from DOM
  let fieldName = labelTextParam?.trim() || '';
  
  if (!fieldName && element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) fieldName = label.textContent?.trim() || '';
  }
  
  // For LeanIX selects, convert data-field-name to readable name
  if (!fieldName && isLxSelect) {
    // Convert "relITComponentToTBMCategory" to "TBM Category" etc.
    fieldName = fieldId
      .replace(/^rel[A-Z][a-zA-Z]*To/, '') // Remove "relXxxTo" prefix
      .replace(/([A-Z])/g, ' $1') // Add space before capitals
      .replace(/[-_]/g, ' ')
      .trim();
  }
  
  // For Tiptap, look for nearby labels
  if (!fieldName && isTiptap) {
    const container = element.closest('[data-field-id], [data-field-name], .field-container');
    if (container) {
      const label = container.querySelector('label, .label');
      if (label) fieldName = label.textContent?.trim() || '';
    }
  }
  
  if (!fieldName) {
    fieldName = element.getAttribute?.('aria-label') ||
                element.getAttribute?.('placeholder') ||
                element.getAttribute?.('title') ||
                fieldId.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1').trim();
  }
  
  // Capitalize each word
  fieldName = fieldName.split(' ')
    .filter(word => word.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // Get current value - handle different element types
  let currentValue = '';
  const isSelect = element.tagName === 'SELECT';
  const isCustomSelect = safeMatches(element, '[role="combobox"], [role="listbox"], [data-select]') || 
                         element.hasAttribute?.('aria-haspopup');
  
  if (isLxSelect) {
    // For LeanIX custom selects, get value from .selection div or selected option
    const selectionDiv = element.querySelector('.selection');
    const selectedOption = element.querySelector('li.keyboardSelectable[aria-selected="true"], li.selected');
    
    if (selectionDiv && selectionDiv.textContent?.trim()) {
      currentValue = selectionDiv.textContent.trim();
    } else if (selectedOption) {
      currentValue = selectedOption.getAttribute('aria-label') || selectedOption.textContent?.trim() || '';
    }
    log('LX Select current value:', currentValue);
  } else if (isSelect) {
    const selectedOption = element.options?.[element.selectedIndex];
    currentValue = selectedOption ? selectedOption.text : '';
  } else if (isCustomSelect) {
    currentValue = element.getAttribute?.('aria-valuenow') ||
                   element.getAttribute?.('data-value') ||
                   element.querySelector('[class*="value"], [class*="selected"]')?.textContent ||
                   '';
  } else if (isTiptap || element.getAttribute?.('contenteditable') === 'true') {
    currentValue = element.textContent || element.innerText || '';
  } else {
    currentValue = element.value || '';
  }
  
  return {
    fieldId,
    fieldName,
    currentValue: currentValue.trim(),
    isTiptap,
    isSelect: isSelect || isCustomSelect || isLxSelect,
    isLxSelect
  };
}

// Apply a value to a field on the page
function applyFieldValue(fieldId, value) {
  log('Applying value:', fieldId, '=', value);
  
  // Try multiple selectors to find the field
  const selectors = [
    `lx-relating-fact-sheet-select[data-field-name="${fieldId}"]`,
    `[data-field-id="${fieldId}"]`,
    `[data-field-name="${fieldId}"]`,
    `[name="${fieldId}"]`,
    `#${CSS.escape(fieldId)}`,
    `[data-testid="${fieldId}"]`,
  ];
  
  let element = null;
  for (const selector of selectors) {
    try {
      element = document.querySelector(selector);
      if (element) {
        log('Found element with selector:', selector);
        // If the element is not an input, try to find input inside (but keep lx-select as is)
        if (!safeMatches(element, 'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], ' + LX_SELECT_SELECTORS)) {
          const input = element.querySelector('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"]');
          if (input) element = input;
        }
        break;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }
  
  if (!element) {
    console.error('[LeanIX AI] Field not found:', fieldId);
    return { success: false, error: 'Field not found on page' };
  }
  
  try {
    const isLxSelect = safeMatches(element, LX_SELECT_SELECTORS);
    const isCustomSelect = safeMatches(element, '[role="combobox"], [role="listbox"], [data-select]') || 
                           element.hasAttribute?.('aria-haspopup');
    
    if (isLxSelect) {
      log('Handling LeanIX select element');
      
      // Click on the selectContainer to open dropdown
      const selectContainer = element.querySelector('.selectContainer');
      if (selectContainer) {
        selectContainer.click();
        log('Clicked selectContainer to open dropdown');
      }
      
      // Wait for dropdown to open, then type in search input and select option
      setTimeout(() => {
        const queryInput = element.querySelector('.queryInput, input[type="text"]');
        if (queryInput) {
          queryInput.focus();
          queryInput.value = value;
          queryInput.dispatchEvent(new Event('input', { bubbles: true }));
          log('Typed search value:', value);
        }
        
        // Wait for search results, then click matching option
        setTimeout(() => {
          const options = element.querySelectorAll('li[aria-label], li.keyboardSelectable, .option');
          log('Found options:', options.length);
          
          let matched = false;
          for (const option of options) {
            const optionLabel = option.getAttribute('aria-label') || option.textContent?.trim();
            
            if (optionLabel?.toLowerCase() === value.toLowerCase() || 
                optionLabel?.toLowerCase().includes(value.toLowerCase())) {
              option.click();
              log('Clicked matching option:', optionLabel);
              matched = true;
              break;
            }
          }
          
          if (!matched) {
            const firstOption = element.querySelector('li.keyboardSelectable, li[aria-label], .option');
            if (firstOption) {
              firstOption.click();
              log('Clicked first available option');
            }
          }
        }, 300);
      }, 100);
      
      return { success: true };
    } else if (element.tagName === 'SELECT') {
      const options = Array.from(element.options);
      const matchingOption = options.find(opt => 
        opt.value === value || 
        opt.text === value || 
        opt.text.toLowerCase() === value.toLowerCase()
      );
      if (matchingOption) {
        element.value = matchingOption.value;
        element.selectedIndex = matchingOption.index;
      } else {
        element.value = value;
      }
      // Trigger change event for select
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } else if (isCustomSelect) {
      log('Handling custom select element');
      element.click();
      
      setTimeout(() => {
        const options = document.querySelectorAll('[role="option"]');
        for (const option of options) {
          const optionText = option.textContent?.trim().toLowerCase();
          if (optionText === value.toLowerCase() || optionText?.includes(value.toLowerCase())) {
            option.click();
            log('Clicked matching option:', optionText);
            break;
          }
        }
      }, 100);
    } else if (element.getAttribute?.('contenteditable') === 'true') {
      element.focus();
      
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      
      document.execCommand('insertHTML', false, `<p>${value}</p>`);
      
      element.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
    } else {
      element.focus();
      element.value = value;
    }
    
    // Trigger events to notify the page/framework
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
    
    // For React apps
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter && element.tagName === 'INPUT') {
      nativeInputValueSetter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    log('Successfully applied value to:', fieldId);
    return { success: true };
  } catch (error) {
    console.error('[LeanIX AI] Error applying value:', error);
    return { success: false, error: error.message };
  }
}

console.log('[LeanIX AI] Content script ready');
