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

// Check if element is an editable field (including Tiptap/ProseMirror)
function isEditableElement(element) {
  if (!element) return false;
  return element.matches('input, textarea, select, [contenteditable="true"], .tiptap, .ProseMirror');
}

// Find the editable element from a target (handles Tiptap containers)
function findEditableElement(element) {
  if (!element) return null;
  
  // Direct match
  if (isEditableElement(element)) {
    return element;
  }
  
  // Check for Tiptap/ProseMirror inside
  const tiptap = element.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
  if (tiptap) return tiptap;
  
  // Check for regular inputs
  const input = element.querySelector('input, textarea, select');
  if (input) return input;
  
  // Check parent elements for field containers
  const parentField = element.closest('[data-field-id], [data-field-name], .field-container, [class*="field"]');
  if (parentField) {
    const nestedTiptap = parentField.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
    if (nestedTiptap) return nestedTiptap;
    
    const nestedInput = parentField.querySelector('input, textarea, select');
    if (nestedInput) return nestedInput;
  }
  
  return null;
}

// Listen for focus events on input fields
document.addEventListener('focusin', (event) => {
  const element = event.target;
  const targetElement = findEditableElement(element);
  
  if (targetElement && isEditableElement(targetElement)) {
    const fieldData = extractFieldData(targetElement);
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

// Also listen for click events to catch clicks on field labels/containers
document.addEventListener('click', (event) => {
  const element = event.target;
  
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
  
  // Common LeanIX field selectors - including provider
  const fieldSelectors = [
    // Tiptap/ProseMirror editors (for description fields)
    '.tiptap',
    '.ProseMirror',
    '[contenteditable="true"]',
    // Standard input fields
    'input[data-field-id]',
    'textarea[data-field-id]',
    'select[data-field-id]',
    // LeanIX specific selectors
    '[data-testid*="field"]',
    '[class*="field-input"]',
    '[class*="FieldInput"]',
    // Provider field specific selectors
    '[data-field-id="provider"]',
    '[data-field-name="provider"]',
    '[name="provider"]',
    'input[placeholder*="provider" i]',
    '[class*="provider" i] input',
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
  
  // Check for Tiptap/ProseMirror - look for fieldId on parent container
  const isTiptap = element.matches('.tiptap, .ProseMirror') || element.getAttribute('contenteditable') === 'true';
  
  let fieldId = element.getAttribute('data-field-id') ||
                element.getAttribute('data-field-name') ||
                element.getAttribute('name') ||
                element.getAttribute('id') ||
                element.getAttribute('data-testid') ||
                '';
  
  // For Tiptap editors, try to find fieldId from parent elements
  if (!fieldId && isTiptap) {
    const parent = element.closest('[data-field-id], [data-field-name], [class*="description" i], [class*="field"]');
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
    
    // Fallback: assume it's the description field if it's a rich text editor
    if (!fieldId) {
      fieldId = 'description';
    }
  }
  
  if (!fieldId) return null;
  
  // Get field name
  let fieldName = labelText?.trim() || '';
  
  if (!fieldName) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) fieldName = label.textContent?.trim() || '';
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
  
  // Capitalize
  fieldName = fieldName.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // Get current value
  let currentValue = '';
  if (element.tagName === 'SELECT') {
    const selectedOption = element.options?.[element.selectedIndex];
    currentValue = selectedOption ? selectedOption.text : '';
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
    isTiptap: isTiptap
  };
}

// Apply a value to a field on the page
function applyFieldValue(fieldId, value) {
  console.log('[LeanIX AI] Applying value:', fieldId, '=', value);
  
  // Try multiple selectors to find the field
  const selectors = [
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
        // If the element is not an input, try to find input inside
        if (!element.matches('input, textarea, select, [contenteditable="true"]')) {
          const input = element.querySelector('input, textarea, select, [contenteditable="true"]');
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
    // Handle different element types
    if (element.tagName === 'SELECT') {
      const options = Array.from(element.options);
      const matchingOption = options.find(opt => 
        opt.value === value || 
        opt.text === value || 
        opt.text.toLowerCase() === value.toLowerCase()
      );
      if (matchingOption) {
        element.value = matchingOption.value;
      } else {
        element.value = value;
      }
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
