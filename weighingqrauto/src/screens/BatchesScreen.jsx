import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useSelector} from 'react-redux';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {fetchBatches, fetchBatchDetails} from '../services/adminApi';
import DuplicateBatchModal from '../ui/components/DuplicateBatchModal';

export default function BatchesScreen() {
  const {token} = useSelector(s => s.user);

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  // Duplicate modal state
  const [duplicateBatchId, setDuplicateBatchId] = useState(null);

  // Detail dialog state
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [batchDetails, setBatchDetails] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetchBatches(token);
      setBatches(res.batches || []);
    } catch (err) {
      console.warn('Failed to load batches:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleOpenDetails = async batch => {
    setSelectedBatch(batch);
    setDetailLoading(true);
    try {
      const res = await fetchBatchDetails(batch._id, token);
      setBatchDetails(res);
    } catch (err) {
      console.warn('Failed to fetch batch details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredBatches = batches.filter(b => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (b.batchName && b.batchName.toLowerCase().includes(q)) ||
      (b.seedType && b.seedType.toLowerCase().includes(q)) ||
      (b.batchNumber && b.batchNumber.toLowerCase().includes(q)) ||
      (b.locationCode && b.locationCode.toLowerCase().includes(q))
    );
  });

  const renderBatchItem = ({item}) => {
    const filled = item.filledCount || 0;
    const total = item.count || 0;
    const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.badgeWrap}>
            <View style={styles.iconCircle}>
              <Icon name="inventory-2" size={18} color="#1a227f" />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.batchName} numberOfLines={1}>
                {item.batchName}
              </Text>
              <Text style={styles.seedType}>
                {item.seedType || item.crop || 'Crop'} · Batch {item.batchNumber || 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Info Grid */}
        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoLbl}>Location</Text>
            <Text style={styles.infoVal}>{item.locationCode || 'N/A'}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLbl}>Total Packets</Text>
            <Text style={styles.infoVal}>{total}</Text>
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoLbl}>Filled</Text>
            <Text style={[styles.infoVal, {color: '#16a34a'}]}>
              {filled} ({pct}%)
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressBg}>
          <View style={[styles.progressBar, {width: `${pct}%`}]} />
        </View>

        {/* Action Buttons */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.detailBtn}
            onPress={() => handleOpenDetails(item)}>
            <Icon name="info-outline" size={16} color="#475569" />
            <Text style={styles.detailBtnTxt}>Details</Text>
          </TouchableOpacity>

          {/* DUPLICATE BUTTON */}
          <TouchableOpacity
            style={styles.duplicateBtn}
            onPress={() => setDuplicateBatchId(item._id)}>
            <Icon name="content-copy" size={16} color="#1a227f" />
            <Text style={styles.duplicateBtnTxt}>Duplicate</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.headerTitle}>Batches</Text>
            <Text style={styles.headerSub}>
              {batches.length} Total Batches Registered
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshIconBtn} onPress={onRefresh}>
            <Icon name="refresh" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Icon name="search" size={20} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search batches, crop, or location..."
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Icon name="clear" size={18} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#1a227f" />
          <Text style={styles.loadingTxt}>Loading Batches...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredBatches}
          keyExtractor={item => item._id}
          renderItem={renderBatchItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Icon name="inbox" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No batches found</Text>
            </View>
          }
        />
      )}

      {/* Batch Details Modal */}
      <Modal
        visible={Boolean(selectedBatch)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedBatch(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Batch Details</Text>
              <TouchableOpacity onPress={() => setSelectedBatch(null)}>
                <Icon name="close" size={22} color="#475569" />
              </TouchableOpacity>
            </View>

            {detailLoading ? (
              <View style={{padding: 40, alignItems: 'center'}}>
                <ActivityIndicator size="large" color="#1a227f" />
              </View>
            ) : selectedBatch ? (
              <ScrollView style={{padding: 16}}>
                <Text style={styles.detailBatchName}>
                  {selectedBatch.batchName}
                </Text>
                <Text style={styles.detailBatchSub}>
                  {selectedBatch.seedType} · {selectedBatch.locationCode}
                </Text>

                <View style={styles.detailStatsGrid}>
                  <View style={styles.detailStatBox}>
                    <Text style={styles.detailStatLbl}>Total QRs</Text>
                    <Text style={styles.detailStatVal}>
                      {selectedBatch.count || 0}
                    </Text>
                  </View>
                  <View style={styles.detailStatBox}>
                    <Text style={styles.detailStatLbl}>Filled</Text>
                    <Text style={[styles.detailStatVal, {color: '#16a34a'}]}>
                      {selectedBatch.filledCount || 0}
                    </Text>
                  </View>
                  <View style={styles.detailStatBox}>
                    <Text style={styles.detailStatLbl}>Seed Code</Text>
                    <Text style={styles.detailStatVal}>
                      {selectedBatch.seedCode || 'N/A'}
                    </Text>
                  </View>
                </View>

                {/* Duplicate from within Details */}
                <TouchableOpacity
                  style={styles.modalDuplicateBtn}
                  onPress={() => {
                    const id = selectedBatch._id;
                    setSelectedBatch(null);
                    setDuplicateBatchId(id);
                  }}>
                  <Icon name="content-copy" size={18} color="#ffffff" />
                  <Text style={styles.modalDuplicateBtnTxt}>
                    Duplicate This Batch
                  </Text>
                </TouchableOpacity>

                <Text style={styles.packetsListTitle}>
                  Packets in this batch ({batchDetails?.packets?.length || 0}):
                </Text>
                {(batchDetails?.packets || []).slice(0, 30).map((p, idx) => (
                  <View key={p.uniqueId || idx} style={styles.packetItem}>
                    <Text style={styles.packetId}>{p.uniqueId}</Text>
                    <Text style={styles.packetLoc}>
                      {p.locationCode || 'N/A'}
                    </Text>
                    <Text
                      style={[
                        styles.packetStatus,
                        p.status === 'filled' && {color: '#16a34a'},
                      ]}>
                      {p.status}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Duplicate Batch Modal */}
      <DuplicateBatchModal
        visible={Boolean(duplicateBatchId)}
        batchId={duplicateBatchId}
        token={token}
        onClose={() => setDuplicateBatchId(null)}
        onSuccess={() => {
          loadData();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  header: {
    backgroundColor: '#1a227f',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: SPACING.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  refreshIconBtn: {
    padding: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    paddingVertical: 0,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: 30,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTxt: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.muted,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTxt: {
    marginTop: 10,
    fontSize: 14,
    color: COLORS.muted,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...SHADOWS.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(26,34,127,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  seedType: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: RADIUS.md,
    padding: 10,
    marginBottom: 8,
  },
  infoCol: {
    alignItems: 'center',
  },
  infoLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  progressBg: {
    height: 5,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#16a34a',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 4,
  },
  detailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  detailBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  duplicateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: '#1a227f',
    backgroundColor: 'rgba(26,34,127,0.05)',
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  duplicateBtnTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1a227f',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailBatchName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailBatchSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 12,
  },
  detailStatsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  detailStatBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: RADIUS.md,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailStatLbl: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  detailStatVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  modalDuplicateBtn: {
    backgroundColor: '#1a227f',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
    marginBottom: 16,
  },
  modalDuplicateBtnTxt: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  packetsListTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  packetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  packetId: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
    fontFamily: 'monospace',
  },
  packetLoc: {
    fontSize: 11,
    color: '#64748b',
  },
  packetStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'capitalize',
  },
});

