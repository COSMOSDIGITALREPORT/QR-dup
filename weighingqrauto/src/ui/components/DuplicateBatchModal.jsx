import React, {useState, useEffect, useMemo} from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {COLORS, RADIUS, SPACING} from '../theme';
import {fetchBatchDetails, duplicateBatch, getQrImageUrl} from '../../services/adminApi';

const {width: SCREEN_WIDTH} = Dimensions.get('window');

const SEED_PRESETS = [
  {label: 'Soyabean', code: 'SO'},
  {label: 'Wheat', code: 'WH'},
  {label: 'Rice', code: 'RI'},
  {label: 'Maize', code: 'MA'},
  {label: 'Cotton', code: 'CO'},
  {label: 'Mustard', code: 'MU'},
  {label: 'Groundnut', code: 'GN'},
  {label: 'Sunflower', code: 'SF'},
];

function getSeedCodeForCrop(cropName) {
  if (!cropName || typeof cropName !== 'string') return 'SC';
  const trimmed = cropName.trim().toLowerCase();
  const found = SEED_PRESETS.find(p => p.label.toLowerCase() === trimmed);
  if (found) return found.code;
  const letters = cropName.replace(/[^A-Za-z]/g, '');
  return letters.slice(0, 2).toUpperCase() || 'SC';
}

function parseLocationString(loc) {
  if (!loc || typeof loc !== 'string') return null;
  const parts = loc.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 3) {
    const land = parts[0];
    const line = parts[1];
    const count = parseInt(parts[2], 10);
    if (land && line && !isNaN(count) && count > 0) {
      return {land, line, count};
    }
  }
  return null;
}

function formatLocationDisplay(loc) {
  if (!loc || typeof loc !== 'string') return '';
  const parts = loc.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 3) {
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
  }
  return loc.replace(/\s+/g, '');
}

function normalizeLocationCode(loc) {
  if (!loc || typeof loc !== 'string') return '';
  return loc.replace(/\s+/g, '').toUpperCase();
}

export default function DuplicateBatchModal({
  visible,
  batchId,
  token,
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [batchName, setBatchName] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState(null);
  const [qrBaseUrl, setQrBaseUrl] = useState('');

  useEffect(() => {
    (async () => {
      const url = await getQrImageUrl('');
      setQrBaseUrl(url);
    })();
  }, []);

  useEffect(() => {
    if (!visible || !batchId) {
      setBatch(null);
      setBatchName('');
      setRows([]);
      setError('');
      setGeneratedResult(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError('');
    setGeneratedResult(null);

    fetchBatchDetails(batchId, token)
      .then(res => {
        if (!isMounted) return;
        const b = res.batch;
        const pkts = res.packets || [];
        setBatch(b);
        setBatchName(`${b.batchName || 'Batch'} (Duplicate)`);

        const locationMap = new Map();

        pkts.forEach(p => {
          const rawLoc = p.locationCode || b.locationCode || 'R-1-1';
          const normKey = normalizeLocationCode(rawLoc);
          const displayLoc = formatLocationDisplay(rawLoc);
          const cropName = p.crop || b.crop || b.seedType || 'Crop';

          if (!locationMap.has(normKey)) {
            locationMap.set(normKey, {
              location: displayLoc,
              crop: cropName,
              packets: [],
            });
          }
          locationMap.get(normKey).packets.push(p);
        });

        if (locationMap.size === 0) {
          const seedsList =
            Array.isArray(b.seeds) && b.seeds.length > 0
              ? b.seeds
              : [
                  {
                    crop: b.crop || b.seedType || 'Seed',
                    locationCode: b.locationCode || 'R-1-1',
                    count: b.count || 1,
                  },
                ];

          seedsList.forEach(s => {
            const rawLoc = s.locationCode || b.locationCode || 'R-1-1';
            const normKey = normalizeLocationCode(rawLoc);
            const displayLoc = formatLocationDisplay(rawLoc);
            const cropName = s.crop || b.crop || b.seedType || 'Crop';

            if (!locationMap.has(normKey)) {
              locationMap.set(normKey, {
                location: displayLoc,
                crop: cropName,
                packets: Array.from({length: s.count || 1}, () => ({
                  crop: cropName,
                })),
              });
            }
          });
        }

        const sortedEntries = Array.from(locationMap.values()).sort((a, b) => {
          const parseP = s => {
            const parts = (s.location || '').split('-');
            return {
              land: parts[0] || '',
              line: parseInt(parts[1], 10) || 0,
              seq: parseInt(parts[2], 10) || 0,
            };
          };
          const pa = parseP(a);
          const pb = parseP(b);
          if (pa.land !== pb.land) return pa.land.localeCompare(pb.land);
          if (pa.line !== pb.line) return pa.line - pb.line;
          return pa.seq - pb.seq;
        });

        const initialRows = sortedEntries.map((item, idx) => {
          const generatedCount = item.packets.length || 1;
          const initialCropNames = item.packets.map(
            p => p.crop || item.crop || 'Crop',
          );

          return {
            id: `loc-row-${idx}`,
            crop: item.crop,
            location: item.location,
            generated: generatedCount,
            extra: 0,
            cropNames: initialCropNames,
          };
        });

        setRows(initialRows);
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.message || 'Failed to load batch details for duplication');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, batchId, token]);

  const handleExtraChange = (rowIndex, val) => {
    const extraNum = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0);

    setRows(prevRows => {
      const copy = [...prevRows];
      const target = {...copy[rowIndex]};
      const generated = target.generated;
      const totalDesired = generated + extraNum;

      const currentNames = [...target.cropNames];
      if (totalDesired > currentNames.length) {
        const diff = totalDesired - currentNames.length;
        for (let i = 0; i < diff; i++) {
          currentNames.push('');
        }
      } else if (totalDesired < currentNames.length) {
        currentNames.splice(totalDesired);
      }

      target.extra = extraNum;
      target.cropNames = currentNames;
      copy[rowIndex] = target;
      return copy;
    });
  };

  const handleCropNameChange = (rowIndex, nameIndex, value) => {
    setRows(prevRows => {
      const copy = [...prevRows];
      const target = {...copy[rowIndex]};
      const names = [...target.cropNames];
      names[nameIndex] = value;
      target.cropNames = names;
      copy[rowIndex] = target;
      return copy;
    });
  };

  const totalQrs = useMemo(() => {
    return rows.reduce((sum, r) => sum + (r.cropNames?.length || 0), 0);
  }, [rows]);

  const handleGenerate = async () => {
    setError('');

    if (!batchName.trim()) {
      setError('Please enter a Batch Name for the duplicate batch.');
      return;
    }

    if (rows.length === 0) {
      setError('No location rows available to duplicate.');
      return;
    }

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      for (let cIdx = 0; cIdx < row.cropNames.length; cIdx++) {
        const name = (row.cropNames[cIdx] || '').trim();
        if (!name) {
          setError(
            `Crop name is mandatory for every entry. Please fill Crop Name for Location "${row.location}" (Entry #${cIdx + 1}).`,
          );
          return;
        }
      }
    }

    if (totalQrs < 1 || totalQrs > 5000) {
      setError('Total QR codes must be between 1 and 5000.');
      return;
    }

    try {
      setGenerating(true);

      let sc = (batch?.seedCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!sc && rows[0]?.cropNames[0]) {
        sc = getSeedCodeForCrop(rows[0].cropNames[0]);
      }
      if (!sc) sc = 'SC';

      let bc = (batch?.batchCode || '').toUpperCase().replace(/[^A-Za-z0-9]/g, '');
      if (!bc && rows[0]?.location) {
        const p = parseLocationString(rows[0].location);
        if (p) bc = `${p.land}${p.line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      }
      if (!bc) bc = 'B1';

      const count = totalQrs;
      const loc = (
        batch?.locationCode ||
        (rows[0]?.location ? formatLocationDisplay(rows[0].location) : 'R-1-1')
      ).trim();
      const firstCrop = (
        rows[0]?.cropNames[0] ||
        batch?.seedType ||
        batch?.crop ||
        'Crop'
      ).trim();

      const entries = [];
      rows.forEach(r => {
        const locStr = r.location;
        const parsed = parseLocationString(locStr) || {
          land: 'R',
          line: '1',
          count: 1,
        };
        const land =
          parsed.land ||
          (batch?.locationCode
            ? batch.locationCode.split('-')[0]?.trim()
            : 'R') ||
          'R';
        const line =
          parsed.line ||
          (batch?.locationCode
            ? batch.locationCode.split('-')[1]?.trim()
            : '1') ||
          '1';
        const rowBc =
          `${land}${line}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || bc;

        r.cropNames.forEach((cn, cIdx) => {
          const entryCrop = cn.trim();
          const entrySc =
            batch?.seedCode || getSeedCodeForCrop(entryCrop) || sc;
          entries.push({
            cropName: entryCrop,
            crop: entryCrop,
            seedType: entryCrop,
            seedCategory: batch?.seedCategory || '',
            seedCode: entrySc,
            batchNumber: batch?.batchNumber || `${land}-${line}`,
            batchCode: rowBc,
            count: 1,
            srNo: parsed.count != null ? parsed.count : cIdx + 1,
            land,
            line,
            location: locStr,
            locationCode: locStr,
          });
        });
      });

      const payload = {
        batchId,
        action: 'duplicate',
        seedCode: sc,
        batchCode: bc,
        count,
        location: loc,
        cropName: firstCrop,
        crop: firstCrop,
        seedType: firstCrop,
        batchNumber: batch?.batchNumber || 'R-2',
        batchName: batchName.trim(),
        rows: rows.map(r => ({
          location: r.location,
          cropNames: r.cropNames.map(cn => cn.trim()),
          generated: r.generated,
          extra: r.extra,
        })),
        entries,
      };

      const res = await duplicateBatch(payload, token);
      if (!res.success) {
        throw new Error(res.message || 'Duplication failed');
      }

      setGeneratedResult(res);
      onSuccess?.(res);
    } catch (err) {
      setError(err.message || 'Error generating duplicate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={generating ? undefined : onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.headerIconBox}>
              <Icon name="content-copy" size={20} color="#ffffff" />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.headerTitle}>
                Duplicate Batch & Location QR
              </Text>
              <Text style={styles.headerSub}>
                {batch
                  ? `${batch.batchName} · ${rows.length} Location${rows.length === 1 ? '' : 's'}`
                  : 'Loading batch details...'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            disabled={generating}>
            <Icon name="close" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#1a227f" />
            <Text style={styles.loadingTxt}>Loading Batch Configuration...</Text>
          </View>
        ) : generatedResult ? (
          /* Result Screen with Generated QR Labels */
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.resultContent}>
            <View style={styles.successBadge}>
              <Icon name="check-circle" size={54} color="#16a34a" />
              <Text style={styles.successTitle}>Duplication Complete!</Text>
              <Text style={styles.successMsg}>
                Created{' '}
                <Text style={{fontWeight: '700'}}>
                  {generatedResult.batch?.batchName}
                </Text>{' '}
                with{' '}
                <Text style={{fontWeight: '700'}}>
                  {generatedResult.packets?.length || totalQrs}
                </Text>{' '}
                independent QR codes.
              </Text>
            </View>

            <Text style={styles.labelsHeading}>
              Generated QR Labels ({generatedResult.packets?.length || 0})
            </Text>
            <Text style={styles.labelsSub}>
              Format: 1. QR Code · 2. Crop Name · 3. Location · 4. Product ID
              (Bold) · NO Batch Name
            </Text>

            <View style={styles.labelsGrid}>
              {(generatedResult.packets || []).map((p, pIdx) => {
                const imgUri = p.qrCodeUrl?.startsWith('http')
                  ? p.qrCodeUrl
                  : `${qrBaseUrl}${p.qrCodeUrl?.startsWith('/') ? p.qrCodeUrl : `/${p.qrCodeUrl}`}`;

                return (
                  <View key={p.uniqueId || pIdx} style={styles.labelCard}>
                    {/* 1. QR Code */}
                    <Image
                      source={{uri: imgUri}}
                      style={styles.qrImage}
                      resizeMode="contain"
                    />

                    {/* 2. Crop Name */}
                    <Text style={styles.labelCrop}>{p.crop || 'Seed'}</Text>

                    {/* 3. Location Number */}
                    <Text style={styles.labelLoc}>
                      {p.locationCode || 'Location'}
                    </Text>

                    {/* 4. QR Code ID (Product ID) — BOLD */}
                    <Text style={styles.labelId}>{p.uniqueId}</Text>
                  </View>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={onClose}>
              <Text style={styles.doneBtnTxt}>Done / Back to Batches</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          /* Duplication Form */
          <View style={{flex: 1}}>
            <ScrollView
              style={styles.body}
              contentContainerStyle={{paddingBottom: 20}}
              keyboardShouldPersistTaps="handled">
              {/* Batch Name Input */}
              <View style={styles.cardSection}>
                <Text style={styles.fieldLabel}>Duplicate Batch Name</Text>
                <TextInput
                  style={styles.nameInput}
                  value={batchName}
                  onChangeText={setBatchName}
                  placeholder="Enter duplicate batch name"
                  placeholderTextColor={COLORS.muted}
                />
              </View>

              {/* Status & Preview Banner */}
              <View style={styles.infoBanner}>
                <View style={{flex: 1}}>
                  <Text style={styles.infoBannerTitle}>
                    Location-wise QR Configuration
                  </Text>
                  <Text style={styles.infoBannerDesc}>
                    Total entries = Generated + Extra. Each entry gets an
                    editable crop name.
                  </Text>
                </View>
                <View style={styles.totalBadge}>
                  <Text style={styles.totalBadgeTxt}>
                    {totalQrs} Total QRs
                  </Text>
                </View>
              </View>

              {/* Location Rows List */}
              {rows.map((row, rIdx) => (
                <View key={row.id || rIdx} style={styles.rowCard}>
                  <View style={styles.rowCardHeader}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowCrop}>{row.crop}</Text>
                      <View style={styles.locPill}>
                        <Icon name="place" size={14} color="#1a227f" />
                        <Text style={styles.locPillTxt}>{row.location}</Text>
                      </View>
                    </View>
                    <View style={styles.rowCounts}>
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeLbl}>Generated</Text>
                        <Text style={styles.countBadgeVal}>{row.generated}</Text>
                      </View>
                      <View style={styles.extraBox}>
                        <Text style={styles.countBadgeLbl}>Extra</Text>
                        <TextInput
                          style={styles.extraInput}
                          keyboardType="numeric"
                          value={String(row.extra)}
                          onChangeText={v => handleExtraChange(rIdx, v)}
                          maxLength={3}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Crop Names Sub-Entries */}
                  <Text style={styles.cropNamesHeader}>
                    Crop Name Entries ({row.cropNames.length}):
                  </Text>
                  <View style={styles.cropNamesWrap}>
                    {row.cropNames.map((name, cIdx) => (
                      <View key={cIdx} style={styles.cropEntryItem}>
                        <Text style={styles.entryNum}>#{cIdx + 1}</Text>
                        <TextInput
                          style={styles.cropEntryInput}
                          value={name}
                          onChangeText={v =>
                            handleCropNameChange(rIdx, cIdx, v)
                          }
                          placeholder={
                            cIdx === 0
                              ? row.crop || 'Crop Name'
                              : `Crop ${cIdx + 1}`
                          }
                          placeholderTextColor={COLORS.muted}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ))}

              {!!error && (
                <View style={styles.errBox}>
                  <Icon name="error-outline" size={18} color={COLORS.danger} />
                  <Text style={styles.errTxt}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Bottom Actions */}
            <View style={styles.actionsBar}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                disabled={generating}>
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.generateBtn,
                  (generating || totalQrs === 0) && {opacity: 0.6},
                ]}
                onPress={handleGenerate}
                disabled={generating || totalQrs === 0}>
                {generating ? (
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={styles.generateBtnTxt}>Generating QRs...</Text>
                  </View>
                ) : (
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                    <Icon name="qr-code-2" size={18} color="#ffffff" />
                    <Text style={styles.generateBtnTxt}>
                      Generate {totalQrs} QRs
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#1a227f',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  headerSub: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  body: {
    flex: 1,
    padding: 14,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTxt: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.muted,
    fontWeight: '600',
  },
  cardSection: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.md,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  nameInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  infoBanner: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  infoBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a227f',
  },
  infoBannerDesc: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  totalBadge: {
    backgroundColor: '#1a227f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  totalBadgeTxt: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  rowCard: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  rowCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 8,
    marginBottom: 8,
  },
  rowLeft: {
    flex: 1,
  },
  rowCrop: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  locPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,34,127,0.08)',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: 'flex-start',
    gap: 4,
  },
  locPillTxt: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 11.5,
    color: '#1a227f',
  },
  rowCounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countBadgeLbl: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  countBadgeVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  extraBox: {
    alignItems: 'center',
  },
  extraInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#1a227f',
    borderRadius: RADIUS.sm,
    width: 44,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: '#1a227f',
    paddingVertical: 3,
    paddingHorizontal: 2,
    marginTop: 2,
  },
  cropNamesHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 6,
  },
  cropNamesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cropEntryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
    minWidth: 140,
    flexGrow: 1,
  },
  entryNum: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1a227f',
  },
  cropEntryInput: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
    paddingVertical: 2,
    paddingHorizontal: 4,
    flex: 1,
  },
  errBox: {
    backgroundColor: '#fee2e2',
    borderRadius: RADIUS.md,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  errTxt: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.danger,
    flex: 1,
  },
  actionsBar: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  cancelBtnTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  generateBtn: {
    backgroundColor: '#1a227f',
    borderRadius: RADIUS.md,
    paddingHorizontal: 20,
    paddingVertical: 11,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtnTxt: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  resultContent: {
    alignItems: 'center',
    paddingBottom: 30,
  },
  successBadge: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    width: '100%',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 8,
  },
  successMsg: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    marginTop: 4,
  },
  labelsHeading: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  labelsSub: {
    fontSize: 11,
    color: '#64748b',
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  labelsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  labelCard: {
    width: (SCREEN_WIDTH - 38) / 2,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: RADIUS.md,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  qrImage: {
    width: 100,
    height: 100,
  },
  labelCrop: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 6,
    textAlign: 'center',
  },
  labelLoc: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a227f',
    fontFamily: 'monospace',
    marginTop: 3,
    textAlign: 'center',
  },
  labelId: {
    fontSize: 10,
    fontWeight: '800', // BOLD font per spec!
    color: '#0f172a',
    fontFamily: 'monospace',
    marginTop: 2,
    textAlign: 'center',
  },
  doneBtn: {
    backgroundColor: '#1a227f',
    borderRadius: RADIUS.md,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
  },
  doneBtnTxt: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});

