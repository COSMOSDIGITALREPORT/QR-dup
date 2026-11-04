#!/usr/bin/env node
'use strict';

/**
 * Verification script for Firebase Admin SDK & Cloud Firestore connection.
 * Safe to run: does NOT log or expose private keys or credentials.
 * Usage: node verify-firebase.js
 */

require('dotenv').config();
const { isFirebaseConfigured, resolveCredentials, getFirestore, closeFirebase } = require('./config/firebase');

async function verify() {
  console.log('\n🔍 Verifying Firebase Configuration...\n');

  const configured = isFirebaseConfigured();
  if (!configured) {
    console.error('❌ Firebase is not configured.');
    console.error('   Please set FIREBASE_SERVICE_ACCOUNT_PATH in your .env or environment.');
    console.error('   Example: FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json\n');
    process.exit(1);
  }

  let creds;
  try {
    creds = resolveCredentials();
  } catch (err) {
    console.error(`❌ Credential loading error: ${err.message}\n`);
    process.exit(1);
  }

  // Display safe metadata only (never the private key)
  console.log('✅ Service Account JSON found and parsed successfully.');
  console.log(`   Project ID   : ${creds.project_id}`);
  console.log(`   Client Email : ${creds.client_email}`);

  console.log('\n📡 Testing connection to Cloud Firestore...');
  const startTime = Date.now();

  try {
    const db = getFirestore();
    // Test read operation: list collections in the root of the database
    const collections = await db.listCollections();
    const elapsed = Date.now() - startTime;

    console.log(`✅ Cloud Firestore connected successfully in ${elapsed}ms!`);
    console.log(`   Existing collections found in Firestore: ${collections.length}`);
    if (collections.length > 0) {
      console.log(`   Collections: ${collections.map((c) => c.id).join(', ')}`);
    } else {
      console.log('   (Database is currently empty - ready for migration)');
    }

    console.log('\n🎉 Firebase Admin SDK and Cloud Firestore verification passed!\n');
    await closeFirebase();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Failed to connect to Cloud Firestore:');
    console.error(`   Error Code: ${err.code || 'UNKNOWN'}`);
    console.error(`   Message   : ${err.message}`);
    console.error('\n💡 Troubleshooting Tips:');
    console.error('   1. Ensure Cloud Firestore has been created in your Firebase Console.');
    console.error('   2. Verify that the project ID matches your Firebase project.');
    console.error('   3. Verify network/internet access to firestore.googleapis.com.');
    console.error('   4. Ensure the service account has "Firebase Admin SDK Administrator Service Agent" or "Cloud Datastore User" role.\n');
    await closeFirebase();
    process.exit(1);
  }
}

verify();

