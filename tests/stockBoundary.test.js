import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStockBoundary } from '../src/utils/stockBoundary.js';

describe('Tala Test Suite: Stock Availability & availableAfter Boundary Logic', () => {
  it('TEST 1: Exact boundary exhaustion (availableAfter == 0) allows fulfillment but flags depletion', () => {
    // Inventory: 50ml, Per serving: 25ml, Order: 2 servings -> Required: 50ml -> availableAfter: 0
    const result = evaluateStockBoundary({
      inventoryQuantity: 50,
      perServing: 25,
      orderQuantity: 2,
    });

    assert.equal(result.required, 50, 'Required quantity must be exactly 50');
    assert.equal(result.availableAfter, 0, 'availableAfter must be exactly 0 (exhaustion point)');
    assert.equal(result.canFulfill, true, 'Order must be fulfilled since stock exactly matches demand');
    assert.equal(result.isDepletedAfter, true, 'isDepletedAfter must be true when availableAfter <= 0');
    assert.equal(result.hasShortage, false, 'hasShortage must be false when availableAfter == 0');
    assert.equal(result.shortageAmount, 0, 'Shortage amount must be 0');
  });

  it('TEST 2: Strict deficit shortage (availableAfter < 0) blocks fulfillment and calculates exact shortage', () => {
    // Inventory: 40ml, Per serving: 25ml, Order: 2 servings -> Required: 50ml -> availableAfter: -10
    const result = evaluateStockBoundary({
      inventoryQuantity: 40,
      perServing: 25,
      orderQuantity: 2,
    });

    assert.equal(result.required, 50, 'Required quantity must be 50');
    assert.equal(result.availableAfter, -10, 'availableAfter must be -10');
    assert.equal(result.canFulfill, false, 'canFulfill must be false when inventory is insufficient');
    assert.equal(result.isDepletedAfter, true, 'isDepletedAfter must be true on deficit');
    assert.equal(result.hasShortage, true, 'hasShortage must be true on deficit');
    assert.equal(result.shortageAmount, 10, 'Shortage amount must be exactly 10');
  });

  it('TEST 3: Zero initial inventory (inventoryQuantity <= 0) blocks fulfillment immediately', () => {
    // Inventory: 0, Per serving: 25ml, Order: 1 serving -> Required: 25ml -> availableAfter: -25
    const result = evaluateStockBoundary({
      inventoryQuantity: 0,
      perServing: 25,
      orderQuantity: 1,
    });

    assert.equal(result.required, 25, 'Required quantity must be 25');
    assert.equal(result.availableAfter, -25, 'availableAfter must be -25');
    assert.equal(result.canFulfill, false, 'canFulfill must be false on 0 stock');
    assert.equal(result.isDepletedAfter, true, 'isDepletedAfter must be true');
    assert.equal(result.hasShortage, true, 'hasShortage must be true');
    assert.equal(result.shortageAmount, 25, 'Shortage amount must be 25');
  });
});
