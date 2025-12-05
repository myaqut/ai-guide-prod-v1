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

// Listen for focus events on input fields
document.addEventListener('focusin', (event) => {
  const element = event.target;
  if (element.matches('input, textarea, select, [contenteditable="true"]')) {
    const fieldData = extractFieldData(element);
    if (fieldData && !shouldIgnoreField(fieldData.fieldName, fieldData.fieldId)) {
      activeField = fieldData;
      console.log('[LeanIX AI] Active field detected:', activeField);
      
      // Notify popup about new active field
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
}, true);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[LeanIX AI] Received message:', request);
  
  if (request.action === 'getPageData') {
    const pageData = extractPageData();
    console.log('[LeanIX AI] Extracted page data:', pageData);
    sendResponse(pageData);
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

// Extract all form fields from the page
function extractPageData() {
  const pageTitle = document.querySelector('h1, .page-title, [data-testid="factsheet-title"]')?.textContent?.trim() || 
                    document.title || 
                    'LeanIX Page';
  
  const fields = [];
  const processedIds = new Set();
  
  // Common LeanIX field selectors - including provider
  const fieldSelectors = [
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
    // Contenteditable fields
    '[contenteditable="true"]',
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
  
  const fieldId = element.getAttribute('data-field-id') ||
                  element.getAttribute('data-field-name') ||
                  element.getAttribute('name') ||
                  element.getAttribute('id') ||
                  element.getAttribute('data-testid') ||
                  '';
  
  if (!fieldId) return null;
  
  // Get field name
  let fieldName = labelText?.trim() || '';
  
  if (!fieldName) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) fieldName = label.textContent?.trim() || '';
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
  } else if (element.getAttribute('contenteditable') === 'true') {
    currentValue = element.textContent || '';
  } else {
    currentValue = element.value || '';
  }
  
  return {
    fieldId,
    fieldName,
    currentValue: currentValue.trim()
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
      element.textContent = value;
      element.innerHTML = value;
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
    
    console.log('[LeanIX AI] Successfully applied value to:', fieldId);
    return { success: true };
  } catch (error) {
    console.error('[LeanIX AI] Error applying value:', error);
    return { success: false, error: error.message };
  }
}

console.log('[LeanIX AI] Content script ready');
