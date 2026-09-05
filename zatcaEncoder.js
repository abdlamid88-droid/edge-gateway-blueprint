const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');

/**
 * Strips ZATCA-specific elements from the UBL XML before hashing.
 * Removes ext:UBLExtensions, cac:Signature, and cac:AdditionalDocumentReference with cbc:ID = "QR".
 * 
 * @param {string} xmlString - The raw XML content.
 * @returns {object} The parsed and stripped XML Document object.
 */
function stripXmlForHashing(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  
  // 1. Remove ext:UBLExtensions
  const extNodes = doc.getElementsByTagNameNS(
    'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2', 
    'UBLExtensions'
  );
  while (extNodes.length > 0) {
    extNodes[0].parentNode.removeChild(extNodes[0]);
  }
  
  // 2. Remove cac:Signature
  const sigNodes = doc.getElementsByTagNameNS(
    'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', 
    'Signature'
  );
  while (sigNodes.length > 0) {
    sigNodes[0].parentNode.removeChild(sigNodes[0]);
  }
  
  // 3. Remove cac:AdditionalDocumentReference where cbc:ID is "QR"
  const refNodes = doc.getElementsByTagNameNS(
    'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', 
    'AdditionalDocumentReference'
  );
  const refsToRemove = [];
  for (let i = 0; i < refNodes.length; i++) {
    const refNode = refNodes[i];
    const idNodes = refNode.getElementsByTagNameNS(
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2', 
      'ID'
    );
    if (idNodes.length > 0 && idNodes[0].textContent === 'QR') {
      refsToRemove.push(refNode);
    }
  }
  for (const refNode of refsToRemove) {
    refNode.parentNode.removeChild(refNode);
  }
  
  return doc;
}

function hasElementChildren(node) {
  if (!node.childNodes) return false;
  for (let i = 0; i < node.childNodes.length; i++) {
    if (node.childNodes[i].nodeType === 1) {
      return true;
    }
  }
  return false;
}

/**
 * Standard C14N XML serializer. Recursively serializes the DOM nodes,
 * sorts element attributes alphabetically, and escapes special characters.
 * 
 * @param {object} node - The DOM node to serialize.
 * @returns {string} The canonicalized XML string.
 */
function c14nSerialize(node) {
  if (node.nodeType === 3) { // Text node
    // Ignore formatting whitespace text nodes between element tags
    if (node.parentNode && hasElementChildren(node.parentNode)) {
      return '';
    }
    return node.nodeValue
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\r/g, '&#xD;');
  }
  
  if (node.nodeType === 1) { // Element node
    let res = `<${node.tagName}`;
    
    // Collect attributes
    const attrs = [];
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        attrs.push({ name: attr.name, value: attr.value });
      }
    }
    
    // Sort attributes alphabetically
    attrs.sort((a, b) => a.name.localeCompare(b.name));
    
    for (const attr of attrs) {
      const escapedValue = attr.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      res += ` ${attr.name}="${escapedValue}"`;
    }
    
    res += '>';
    
    // Serialize children
    if (node.childNodes) {
      for (let i = 0; i < node.childNodes.length; i++) {
        res += c14nSerialize(node.childNodes[i]);
      }
    }
    
    res += `</${node.tagName}>`;
    return res;
  }
  
  if (node.nodeType === 9) { // Document node
    return c14nSerialize(node.documentElement);
  }
  
  return '';
}

/**
 * Generates a ZATCA-compliant Base64 encoded TLV structured QR code.
 * 
 * @param {object} tags - An object containing tag IDs (1-9) as keys and strings or Buffers as values.
 * @returns {string} The Base64 encoded TLV QR code.
 */
function generateTlvQrCode(tags) {
  const buffers = [];
  
  // Sort tag IDs numerically
  const sortedKeys = Object.keys(tags).map(Number).sort((a, b) => a - b);
  
  for (const tagId of sortedKeys) {
    if (tagId < 1 || tagId > 9) {
      throw new Error(`Invalid tag ID: ${tagId}. Tags must be between 1 and 9.`);
    }
    
    const value = tags[tagId];
    let valueBuffer;
    
    if (Buffer.isBuffer(value)) {
      valueBuffer = value;
    } else if (typeof value === 'string') {
      valueBuffer = Buffer.from(value, 'utf-8');
    } else {
      valueBuffer = Buffer.from(String(value), 'utf-8');
    }
    
    const length = valueBuffer.length;
    if (length > 255) {
      throw new Error(`Value for tag {tagId} exceeds maximum allowed length of 255 bytes (got ${length} bytes).`);
    }
    
    const header = Buffer.from([tagId, length]);
    buffers.push(header, valueBuffer);
  }
  
  const finalBuffer = Buffer.concat(buffers);
  return finalBuffer.toString('base64');
}

/**
 * Calculates the SHA-256 hash of an XML UBL 2.1 invoice and signs it using ECDSA (secp256k1).
 * Returns the invoice hash (Base64), ECDSA signature in raw IEEE P1363 format (Base64), and SPKI DER public key.
 * 
 * @param {string} xmlString - The raw XML content of the UBL 2.1 invoice.
 * @param {string} privateKeyPem - The PEM-encoded private key (secp256k1).
 * @returns {object} An object containing { invoiceHash, signature, publicKeyDer }
 */
function hashAndSignInvoice(xmlString, privateKeyPem) {
  // 1. Parse and strip the XML
  const strippedDoc = stripXmlForHashing(xmlString);
  
  // 2. Canonicalize the stripped XML
  const canonicalXml = c14nSerialize(strippedDoc);
  
  // 3. Calculate SHA-256 Hash of canonical XML
  const hash = crypto.createHash('sha256').update(canonicalXml).digest();
  const invoiceHashB64 = hash.toString('base64');
  
  // 4. Sign the canonical XML using ECDSA (secp256k1) with SHA-256 in ieee-p1363 (raw r + s) format
  const sign = crypto.createSign('SHA256');
  sign.update(canonicalXml);
  const signatureBuffer = sign.sign({
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363'
  });
  const signatureB64 = signatureBuffer.toString('base64');
  
  // 5. Extract the public key in DER format
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({
    type: 'spki',
    format: 'der'
  });
  
  return {
    invoiceHash: invoiceHashB64,
    signature: signatureB64,
    publicKeyDer: publicKeyDer
  };
}

// Express Router POST Route definition
router.post('/invoice/sign', (req, res) => {
  try {
    const { 
      xmlString, 
      privateKeyPem, 
      supplierName, 
      vatNumber, 
      timestamp, 
      totalAmount, 
      vatAmount 
    } = req.body;
    
    if (!xmlString || !privateKeyPem) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing mandatory fields: xmlString and privateKeyPem are required." 
      });
    }

    // Hash and Sign
    const { invoiceHash, signature, publicKeyDer } = hashAndSignInvoice(xmlString, privateKeyPem);

    // Generate ZATCA Phase 2 QR Code
    const qrCodeBase64 = generateTlvQrCode({
      1: supplierName || "Dummy Developer Enterprise",
      2: vatNumber || "399999999900003",
      3: timestamp || "2026-06-16T17:20:00Z",
      4: totalAmount || "115.00",
      5: vatAmount || "15.00",
      6: invoiceHash,
      7: signature,
      8: publicKeyDer,
      9: Buffer.from("mock-cert-signature-value")
    });

    res.json({
      success: true,
      invoiceHash,
      signature,
      qrCodeBase64
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Attach helper functions to the router object for compatibility with unit tests
router.generateTlvQrCode = generateTlvQrCode;
router.hashAndSignInvoice = hashAndSignInvoice;
router.stripXmlForHashing = stripXmlForHashing;
router.c14nSerialize = c14nSerialize;

module.exports = router;
