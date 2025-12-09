// Content script for LeanIX AI Recommendations extension
// This script runs on LeanIX pages and extracts form field data

console.log('[LeanIX AI] Content script loaded');

// Fields to ignore
const IGNORED_FIELDS = [
  'external id',
  'externalid',
  'external_id',
  'product id',
  'productid',
  'product_id',
];

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

// Check if element is an editable field (including Tiptap/ProseMirror and custom dropdowns)
function isEditableElement(element) {
  if (!element) return false;
  
  // Standard form elements and contenteditable
  if (element.matches('input, textarea, select, [contenteditable="true"], .tiptap, .ProseMirror')) {
    return true;
  }
  
  // LeanIX custom select components
  if (element.matches('lx-single-select, lx-relating-fact-sheet-select, lx-fact-sheet-select, lx-dropdown-with-tree-view')) {
    return true;
  }
  
  // LeanIX select container and input elements
  if (element.matches('.selectContainer, .queryInput, .selectionContainer')) {
    return true;
  }
  
  // Custom dropdown/select components (common patterns)
  if (element.matches('[role="combobox"], [role="listbox"], [role="option"], [data-select], [class*="select" i], [class*="dropdown" i], [class*="picker" i]')) {
    return true;
  }
  
  // Check for data-field-name attribute (LeanIX specific)
  if (element.hasAttribute('data-field-name') || element.hasAttribute('data-field-target-selector')) {
    return true;
  }
  
  // Check for aria attributes indicating a select-like element
  if (element.hasAttribute('aria-haspopup') || element.hasAttribute('aria-expanded')) {
    return true;
  }
  
  return false;
}

// Find the editable element from a target (handles Tiptap containers and custom dropdowns)
function findEditableElement(element) {
  if (!element) return null;
  
  // Check for LeanIX custom select components first (bubble up from clicked element)
  const lxSelect = element.closest('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
  if (lxSelect) return lxSelect;
  
  // Check if we're inside a .selectContainer (LeanIX dropdown)
  const selectContainer = element.closest('.selectContainer');
  if (selectContainer) {
    const parentSelect = selectContainer.closest('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
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
  const lxSelectInside = element.querySelector('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
  if (lxSelectInside) return lxSelectInside;
  
  // Check for custom dropdown/select components
  const customSelect = element.querySelector('[role="combobox"], [role="listbox"], [data-select], [class*="select" i]:not(style):not(script), [class*="dropdown" i]:not(style):not(script)');
  if (customSelect) return customSelect;
  
  // Check parent elements for field containers
  const parentField = element.closest('[data-field-id], [data-field-name], .field-container, [class*="field"]');
  if (parentField) {
    const nestedLxSelect = parentField.querySelector('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
    if (nestedLxSelect) return nestedLxSelect;
    
    const nestedTiptap = parentField.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
    if (nestedTiptap) return nestedTiptap;
    
    const nestedInput = parentField.querySelector('input, textarea, select');
    if (nestedInput) return nestedInput;
    
    const nestedCustomSelect = parentField.querySelector('[role="combobox"], [role="listbox"], [data-select]');
    if (nestedCustomSelect) return nestedCustomSelect;
  }
  
  return null;
}

// Listen for focus events on input fields
document.addEventListener('focusin', (event) => {
  const element = event.target;
  console.log('[LeanIX AI] Focusin event on:', element.tagName, element.className);
  
  const targetElement = findEditableElement(element);
  
  if (targetElement && isEditableElement(targetElement)) {
    const fieldData = extractFieldData(targetElement);
    console.log('[LeanIX AI] Extracted field data:', fieldData);
    
    if (fieldData && !shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
      activeField = fieldData;
      
      console.log('[LeanIX AI] Active field detected:', activeField.fieldName, activeField.fieldId);
      
      // Always notify popup about active field
      try {
        chrome.runtime.sendMessage({
          action: 'activeFieldChanged',
          field: activeField
        });
      } catch (e) {
        console.log('[LeanIX AI] Could not send message to popup');
      }
    }
  }
}, true);

// Listen for click events specifically for LeanIX custom select components
document.addEventListener('click', (event) => {
  const element = event.target;
  
  console.log('[LeanIX AI] Click on element:', element.tagName, element.className?.substring?.(0, 50));
  
  // Check if clicked inside a LeanIX select component - find the outermost lx-relating-fact-sheet-select
  let lxSelect = element.closest('lx-relating-fact-sheet-select');
  
  // If not found directly, check if we're inside lx-single-select or lx-fact-sheet-select
  if (!lxSelect) {
    const innerSelect = element.closest('lx-single-select, lx-fact-sheet-select');
    if (innerSelect) {
      // Look for parent lx-relating-fact-sheet-select
      lxSelect = innerSelect.closest('lx-relating-fact-sheet-select');
      if (!lxSelect) {
        // Use the inner select if no parent found
        lxSelect = innerSelect;
      }
    }
  }
  
  // Also check for selectContainer clicks
  if (!lxSelect) {
    const selectContainer = element.closest('.selectContainer, .selectionContainer, .inputContainer');
    if (selectContainer) {
      lxSelect = selectContainer.closest('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
    }
  }
  
  if (lxSelect) {
    // Try to get data-field-name, first from current element, then from parents
    let fieldName = lxSelect.getAttribute('data-field-name');
    if (!fieldName) {
      const parent = lxSelect.closest('[data-field-name]');
      if (parent) {
        fieldName = parent.getAttribute('data-field-name');
        lxSelect = parent; // Use the parent that has the field name
      }
    }
    
    console.log('[LeanIX AI] Click detected on LeanIX select, field-name:', fieldName);
    
    if (fieldName) {
      const fieldData = extractFieldData(lxSelect);
      console.log('[LeanIX AI] LX Select field data:', fieldData);
      
      if (fieldData && !shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
        activeField = fieldData;
        
        console.log('[LeanIX AI] LX Select active field set:', activeField.fieldName, activeField.fieldId);
        
        try {
          chrome.runtime.sendMessage({
            action: 'activeFieldChanged',
            field: activeField
          });
        } catch (e) {
          console.log('[LeanIX AI] Could not send message to popup');
        }
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
        if (fieldData && !shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
          activeField = fieldData;
          console.log('[LeanIX AI] Field detected via label click:', activeField.fieldName);
          
          try {
            chrome.runtime.sendMessage({
              action: 'activeFieldChanged',
              field: activeField
            });
          } catch (e) {
            // Popup might not be open
          }
        }
      }
    }
  }
}, true);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[LeanIX AI] Received message:', request);
  
  if (request.action === 'getPageData') {
    const pageData = extractPageData();
    console.log('[LeanIX AI] Extracted page data:', pageData);
    sendResponse(pageData);
  } else if (request.action === 'getNameField') {
    // Specifically get the Name field - this is the entry point
    const nameField = findNameField();
    const pageTitle = document.querySelector('h1, .page-title, [data-testid="factsheet-title"]')?.textContent?.trim() || 
                      document.title || 
                      'LeanIX Page';
    console.log('[LeanIX AI] Returning Name field:', nameField);
    sendResponse({ 
      field: nameField, 
      pageContext: pageTitle 
    });
  } else if (request.action === 'getActiveField') {
    console.log('[LeanIX AI] Returning active field:', activeField);
    sendResponse({ field: activeField });
  } else if (request.action === 'applyRecommendation') {
    const result = applyFieldValue(request.fieldId, request.value);
    console.log('[LeanIX AI] Apply result:', result);
    sendResponse(result);
  }
  
  return true; // Keep the message channel open for async response
});

// Find the Name field on the page - searches FRESH each time
function findNameField() {
  console.log('[LeanIX AI] Searching for Name field...');
  
  // First, try to find by label text "Name" and get associated input
  const allLabels = document.querySelectorAll('label');
  for (const label of allLabels) {
    const labelText = label.textContent?.trim().replace(/\s*\*\s*$/, '').toLowerCase(); // Remove asterisk
    if (labelText === 'name') {
      console.log('[LeanIX AI] Found Name label:', label);
      
      // Try 'for' attribute
      const forId = label.getAttribute('for');
      if (forId) {
        const input = document.getElementById(forId);
        if (input) {
          console.log('[LeanIX AI] Found input by for attribute:', input.value);
          return extractFieldData(input, 'Name');
        }
      }
      
      // Try sibling input
      const parent = label.parentElement;
      if (parent) {
        const input = parent.querySelector('input[type="text"], input:not([type]), textarea');
        if (input) {
          console.log('[LeanIX AI] Found input as sibling:', input.value);
          return extractFieldData(input, 'Name');
        }
      }
      
      // Try nested input
      const nestedInput = label.querySelector('input, textarea');
      if (nestedInput) {
        console.log('[LeanIX AI] Found nested input:', nestedInput.value);
        return extractFieldData(nestedInput, 'Name');
      }
      
      // Try next sibling element
      const nextElement = label.nextElementSibling;
      if (nextElement) {
        const input = nextElement.matches('input, textarea') ? nextElement : nextElement.querySelector('input, textarea');
        if (input) {
          console.log('[LeanIX AI] Found input in next sibling:', input.value);
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
          console.log('[LeanIX AI] Found Name by selector:', selector, fieldData.currentValue);
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
      console.log('[LeanIX AI] Found Name by input scan:', fieldData.currentValue);
      return fieldData;
    }
  }
  
  console.log('[LeanIX AI] Name field not found');
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
          // Skip ignored fields
          if (shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
            console.log('[LeanIX AI] Ignoring field:', fieldData.fieldName);
            return;
          }
          processedIds.add(fieldData.fieldId);
          fields.push(fieldData);
        }
      });
    } catch (e) {
      console.warn('[LeanIX AI] Error with selector:', selector, e);
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
          // Skip ignored fields
          if (shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
            console.log('[LeanIX AI] Ignoring field:', fieldData.fieldName);
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
function extractFieldData(element, labelText = '') {
  if (!element) return null;
  
  // Skip hidden elements
  if (element.type === 'hidden') return null;
  
  // Check for LeanIX custom select components (Angular)
  const isLxSelect = element.matches('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
  
  // Check for Tiptap/ProseMirror - look for fieldId on parent container
  const isTiptap = element.matches('.tiptap, .ProseMirror') || element.getAttribute('contenteditable') === 'true';
  
  let fieldId = element.getAttribute('data-field-id') ||
                element.getAttribute('data-field-name') ||
                element.getAttribute('name') ||
                element.getAttribute('id') ||
                element.getAttribute('data-testid') ||
                '';
  
  // For LeanIX custom selects, extract from data-field-name
  if (isLxSelect && !fieldId) {
    fieldId = element.getAttribute('data-field-name') || '';
    console.log('[LeanIX AI] LX Select field detected:', fieldId);
  }
  
  // For Tiptap editors, try to find fieldId from parent elements
  if (!fieldId && isTiptap) {
    const parent = element.closest('[data-field-id], [data-field-name], [class*="description" i]');
    if (parent) {
      fieldId = parent.getAttribute('data-field-id') ||
                parent.getAttribute('data-field-name') ||
                parent.getAttribute('id') ||
                '';
      
      // Check if parent class contains "description"
      if (!fieldId && parent.className.toLowerCase().includes('description')) {
        fieldId = 'description';
      }
    }
    
    // Only use description as fallback if we can confirm it's actually a description field
    // by checking for nearby labels or specific class patterns
    if (!fieldId) {
      const container = element.closest('[class*="field"], .form-group, .field-container');
      if (container) {
        const label = container.querySelector('label, .label, [class*="label"]');
        const labelText = label?.textContent?.toLowerCase()?.trim() || '';
        if (labelText.includes('description')) {
          fieldId = 'description';
        }
      }
    }
    
    // If still no fieldId, skip this element - don't default to description
    if (!fieldId) {
      return null;
    }
  }
  
  if (!fieldId) return null;
  
  // Get field name from fieldId (convert camelCase/kebab to readable name)
  let fieldName = labelText?.trim() || '';
  
  if (!fieldName) {
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
  
  if (!fieldName) {
    // For Tiptap, look for nearby labels
    if (isTiptap) {
      const container = element.closest('[data-field-id], [data-field-name], .field-container, [class*="field"]');
      if (container) {
        const label = container.querySelector('label, .label, [class*="label"]');
        if (label) fieldName = label.textContent?.trim() || '';
      }
    }
  }
  
  if (!fieldName) {
    fieldName = element.getAttribute('aria-label') ||
                element.getAttribute('placeholder') ||
                element.getAttribute('title') ||
                fieldId.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1').trim();
  }
  
  // Capitalize each word
  fieldName = fieldName.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // Get current value - handle different element types
  let currentValue = '';
  const isSelect = element.tagName === 'SELECT';
  const isCustomSelect = element.matches('[role="combobox"], [role="listbox"], [data-select]') || 
                         element.hasAttribute('aria-haspopup');
  
  if (isLxSelect) {
    // For LeanIX custom selects, get value from .selection div or selected option's aria-label
    const selectionDiv = element.querySelector('.selection');
    const selectedOption = element.querySelector('li.keyboardSelectable[aria-selected="true"], li.selected');
    
    if (selectionDiv && selectionDiv.textContent?.trim()) {
      currentValue = selectionDiv.textContent.trim();
    } else if (selectedOption) {
      currentValue = selectedOption.getAttribute('aria-label') || selectedOption.textContent?.trim() || '';
    } else {
      // Check for currently highlighted/focused option
      const focusedOption = element.querySelector('.factSheetName');
      if (focusedOption) {
        currentValue = focusedOption.textContent?.trim() || '';
      }
    }
    console.log('[LeanIX AI] LX Select current value:', currentValue);
  } else if (isSelect) {
    const selectedOption = element.options?.[element.selectedIndex];
    currentValue = selectedOption ? selectedOption.text : '';
  } else if (isCustomSelect) {
    // For custom dropdowns, try to get the displayed value
    currentValue = element.getAttribute('aria-valuenow') ||
                   element.getAttribute('data-value') ||
                   element.querySelector('[class*="value" i], [class*="selected" i], [class*="placeholder" i]')?.textContent ||
                   element.textContent?.trim() || '';
  } else if (isTiptap || element.getAttribute('contenteditable') === 'true') {
    // For Tiptap, get text content
    currentValue = element.textContent || element.innerText || '';
  } else {
    currentValue = element.value || '';
  }
  
  return {
    fieldId,
    fieldName,
    currentValue: currentValue.trim(),
    isTiptap: isTiptap,
    isSelect: isSelect || isCustomSelect || isLxSelect,
    isLxSelect: isLxSelect
  };
}

// Apply a value to a field on the page
function applyFieldValue(fieldId, value) {
  console.log('[LeanIX AI] Applying value:', fieldId, '=', value);
  
  // Try multiple selectors to find the field
  const selectors = [
    // LeanIX custom select first
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
        console.log('[LeanIX AI] Found element with selector:', selector);
        // If the element is not an input, try to find input inside (but keep lx-select as is)
        if (!element.matches('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select')) {
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
    // Check if this is a LeanIX custom select
    const isLxSelect = element.matches('lx-relating-fact-sheet-select, lx-single-select, lx-fact-sheet-select');
    const isCustomSelect = element.matches('[role="combobox"], [role="listbox"], [data-select]') || 
                           element.hasAttribute('aria-haspopup');
    
    if (isLxSelect) {
      // Handle LeanIX Angular select components
      console.log('[LeanIX AI] Handling LeanIX select element');
      
      // Click on the selectContainer to open dropdown
      const selectContainer = element.querySelector('.selectContainer');
      if (selectContainer) {
        selectContainer.click();
        console.log('[LeanIX AI] Clicked selectContainer to open dropdown');
      }
      
      // Wait for dropdown to open, then type in search input and select option
      setTimeout(() => {
        // Find and fill the search input
        const queryInput = element.querySelector('.queryInput, input[type="text"]');
        if (queryInput) {
          queryInput.focus();
          queryInput.value = value;
          queryInput.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[LeanIX AI] Typed search value:', value);
        }
        
        // Wait for search results, then click matching option
        setTimeout(() => {
          // Find options in the dropdown (li elements with aria-label)
          const options = element.querySelectorAll('li[aria-label], li.keyboardSelectable, .option');
          console.log('[LeanIX AI] Found options:', options.length);
          
          let matched = false;
          for (const option of options) {
            const optionLabel = option.getAttribute('aria-label') || option.textContent?.trim();
            console.log('[LeanIX AI] Checking option:', optionLabel);
            
            // Check for exact match or contains match
            if (optionLabel?.toLowerCase() === value.toLowerCase() || 
                optionLabel?.toLowerCase().includes(value.toLowerCase())) {
              option.click();
              console.log('[LeanIX AI] Clicked matching option:', optionLabel);
              matched = true;
              break;
            }
          }
          
          if (!matched) {
            // Try clicking the first option if no exact match
            const firstOption = element.querySelector('li.keyboardSelectable, li[aria-label], .option');
            if (firstOption) {
              firstOption.click();
              console.log('[LeanIX AI] Clicked first available option');
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
      // For custom dropdowns, try to click and select the matching option
      console.log('[LeanIX AI] Handling custom select element');
      element.click(); // Open the dropdown
      
      // Wait briefly for dropdown to open, then find and click the matching option
      setTimeout(() => {
        const options = document.querySelectorAll('[role="option"], [class*="option" i], [class*="menu-item" i], [class*="list-item" i]');
        for (const option of options) {
          const optionText = option.textContent?.trim().toLowerCase();
          if (optionText === value.toLowerCase() || optionText?.includes(value.toLowerCase())) {
            option.click();
            console.log('[LeanIX AI] Clicked matching option:', optionText);
            break;
          }
        }
      }, 100);
    } else if (element.getAttribute('contenteditable') === 'true') {
      // Handle Tiptap/ProseMirror editors
      element.focus();
      
      // Select all existing content and delete it
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Use execCommand to insert text (works with Tiptap)
      document.execCommand('insertHTML', false, `<p>${value}</p>`);
      
      // Also dispatch beforeinput for modern editors
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
      
      // Dispatch input event for Tiptap
      element.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
    } else {
      // Clear and set value
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
    
    // For contenteditable/Tiptap - also try native setter approach
    const nativeTextContentSetter = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype, 'textContent'
    )?.set;
    if (nativeTextContentSetter && element.getAttribute('contenteditable') === 'true') {
      nativeTextContentSetter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    console.log('[LeanIX AI] Successfully applied value to:', fieldId);
    return { success: true };
  } catch (error) {
    console.error('[LeanIX AI] Error applying value:', error);
    return { success: false, error: error.message };
  }
}

console.log('[LeanIX AI] Content script ready');
