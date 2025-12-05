// Content script for LeanIX AI Recommendations Extension
// This script runs on LeanIX pages and extracts form field data

(function() {
  'use strict';

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageData') {
      const pageData = extractPageData();
      sendResponse(pageData);
    }
    return true; // Keep the message channel open for async response
  });

  // Extract form field data from the LeanIX page
  function extractPageData() {
    const fields = [];
    
    // Try to get the page title/context
    const pageTitle = document.querySelector('h1, .page-title, [data-testid="factsheet-title"]')?.textContent?.trim() || 
                      document.title || 
                      'Unknown Page';

    // Look for form fields in LeanIX
    // These selectors target common LeanIX form patterns
    const fieldSelectors = [
      '[data-field-id]',
      '.field-container',
      '.form-field',
      'input[name]',
      'textarea[name]',
      'select[name]',
      '[class*="field"]'
    ];

    fieldSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        const fieldData = extractFieldData(element);
        if (fieldData && !fields.find(f => f.fieldId === fieldData.fieldId)) {
          fields.push(fieldData);
        }
      });
    });

    // Also look for labeled form groups
    document.querySelectorAll('label').forEach(label => {
      const fieldId = label.getAttribute('for');
      const input = fieldId ? document.getElementById(fieldId) : label.querySelector('input, textarea, select');
      
      if (input && !fields.find(f => f.fieldId === input.id || f.fieldId === input.name)) {
        fields.push({
          fieldId: input.id || input.name || `field-${fields.length}`,
          fieldName: label.textContent?.trim() || input.name || 'Unknown Field',
          currentValue: input.value || ''
        });
      }
    });

    return {
      pageContext: pageTitle,
      fields: fields.slice(0, 20) // Limit to 20 fields
    };
  }

  // Extract data from a single field element
  function extractFieldData(element) {
    const fieldId = element.getAttribute('data-field-id') || 
                    element.getAttribute('name') || 
                    element.id ||
                    null;
    
    if (!fieldId) return null;

    const labelElement = element.querySelector('label') || 
                         document.querySelector(`label[for="${fieldId}"]`) ||
                         element.closest('.field-container')?.querySelector('label');
    
    const inputElement = element.querySelector('input, textarea, select') || 
                         (element.matches('input, textarea, select') ? element : null);

    return {
      fieldId: fieldId,
      fieldName: labelElement?.textContent?.trim() || fieldId,
      currentValue: inputElement?.value || element.textContent?.trim() || ''
    };
  }

  // Notify that content script is ready
  console.log('[LeanIX AI] Content script loaded');
})();
