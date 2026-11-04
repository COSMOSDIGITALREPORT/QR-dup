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
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {useSelector} from 'react-redux';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../ui/theme';
import {fetchInventory, getQrImageUrl} from '../services/adminApi';
import DuplicateBatchModal from '../ui/components/DuplicateBatchModal';

export default function ProductsScreen() {
  const {token} = useSelector(s => s.user);

  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({
    totalProducts: 0,
    organicCount: 0,
    hybridCount: 0,
    heirloomModifiedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [qrBaseUrl, setQrBaseUrl] = useState('');

  // Duplicate modal
  const [duplicateBatchId, setDuplicateBatchId] = useState(null);

  // QR Preview modal
  const [previewProduct, setPreviewProduct] = useState(null);

  useEffect(() => {
    (async () => {
      const url = await getQrImageUrl('');
      setQrBaseUrl(url);
    })();
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetchInventory({search}, token);
      setProducts(res.products || []);
      if (res.counts) setCounts(res.counts);
    } catch (err) {
      console.warn('Failed to load inventory:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const renderProductItem = ({item}) => {
    const isFilled = item.status === 'filled';
    const imgUri = item.qrCodeUrl?.startsWith('http')
      ? item.qrCodeUrl
      : `${qrBaseUrl}${item.qrCodeUrl?.startsWith('/') ? item.qrCodeUrl : `/${item.qrCodeUrl}`}`;

    return (
      <View style={styles.card}>
        <View style={styles.cardMain}>
          {/* Left: QR Thumbnail */}
          <TouchableOpacity
            style={styles.qrThumbWrap}
            onPress={() => setPreviewProduct(item)}>
            <Image
              source={{uri: imgUri}}
              style={styles.qrThumb}
              resizeMode="contain"
            />
            <View style={styles.zoomPill}>
              <Icon name="zoom-in" size={12} color="#1a227f" />
            </View>
          </TouchableOpacity>

          {/* Right: Info */}
          <View style={styles.infoCol}>
            <View style={styles.titleRow}>
              <Text style={styles.cropName}>{item.crop || item.name || 'Seed'}</Text>
              <View
                style={[
                  styles.statusBadge,
                  isFilled ? styles.statusFilled : styles.statusEmpty,
                ]}>
                <Text
                  style={[
                    styles.statusBadgeTxt,
                    isFilled && {color: '#16a34a'},
                  ]}>
                  {item.status || 'empty'}
                </Text>
              </View>
            </View>

            {/* Product ID — BOLD */}
            <Text style={styles.productId}>{item.id || item.uniqueId}</Text>

            <View style={styles.tagsRow}>
              <View style={styles.locBadge}>
                <Icon name="place" size={12} color="#1a227f" />
                <Text style={styles.locBadgeTxt}>
                  {item.locationCode || 'N/A'}
                </Text>
              </View>
              <Text style={styles.batchTxt}>
                Batch: {item.batch || item.batchNumber || 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Card Footer with DUPLICATE BUTTON */}
        <View style={styles.cardFooter}>
          <TouchableOpacity
            style={styles.viewQrBtn}
            onPress={() => setPreviewProduct(item)}>
            <Icon name="qr-code" size={15} color="#475569" />
            <Text style={styles.viewQrBtnTxt}>View QR Label</Text>
          </TouchableOpacity>

          {item.batchId && (
            <TouchableOpacity
              style={styles.duplicateBtn}
              onPress={() => setDuplicateBatchId(item.batchId)}>
              <Icon name="content-copy" size={15} color="#1a227f" />
              <Text style={styles.duplicateBtnTxt}>Duplicate</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.headerTitle}>Products & Inventory</Text>
            <Text style={styles.headerSub}>
              {counts.totalProducts || products.length} Unique Seed Packets
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshIconBtn} onPress={onRefresh}>
            <Icon name="refresh" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statChip}>
            <Text style={styles.statNum}>{counts.totalProducts || 0}</Text>
            <Text style={styles.statLbl}>Total</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={[styles.statNum, {color: '#16a34a'}]}>
              {counts.organicCount || 0}
            </Text>
            <Text style={styles.statLbl}>Organic</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={[styles.statNum, {color: '#0ea5e9'}]}>
              {counts.hybridCount || 0}
            </Text>
            <Text style={styles.statLbl}>Hybrid</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={[styles.statNum, {color: '#ea580c'}]}>
              {counts.heirloomModifiedCount || 0}
            </Text>
            <Text style={styles.statLbl}>Heirloom</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBar}>
          <Icon name="search" size={20} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by ID, crop, or location..."
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
          <Text style={styles.loadingTxt}>Loading Products...</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={item => item._id || item.id}
          renderItem={renderProductItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Icon name="inventory" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No products found</Text>
            </View>
          }
        />
      )}

      {/* QR Label Preview Modal (Format: 1. QR, 2. Crop, 3. Location, 4. ID BOLD, NO Batch) */}
      <Modal
        visible={Boolean(previewProduct)}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewProduct(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.qrCardModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>QR Sticker Label</Text>
              <TouchableOpacity onPress={() => setPreviewProduct(null)}>
                <Icon name="close" size={22} color="#475569" />
              </TouchableOpacity>
            </View>

            {previewProduct && (
              <View style={styles.labelPreviewContent}>
                {/* 1. QR Code */}
                <Image
                  source={{
                    uri: previewProduct.qrCodeUrl?.startsWith('http')
                      ? previewProduct.qrCodeUrl
                      : `${qrBaseUrl}${previewProduct.qrCodeUrl?.startsWith('/') ? previewProduct.qrCodeUrl : `/${previewProduct.qrCodeUrl}`}`,
                  }}
                  style={styles.labelPreviewQr}
                  resizeMode="contain"
                />

                {/* 2. Crop Name */}
                <Text style={styles.labelPreviewCrop}>
                  {previewProduct.crop || previewProduct.name || 'Seed'}
                </Text>

                {/* 3. Location Number */}
                <Text style={styles.labelPreviewLoc}>
                  {previewProduct.locationCode || 'Location'}
                </Text>

                {/* 4. QR Code ID (Product ID) — BOLD */}
                <Text style={styles.labelPreviewId}>
                  {previewProduct.id || previewProduct.uniqueId}
                </Text>

                {/* NO BATCH NAME DISPLAYED! */}

                {previewProduct.batchId && (
                  <TouchableOpacity
                    style={styles.modalDuplicateBtn}
                    onPress={() => {
                      const id = previewProduct.batchId;
                      setPreviewProduct(null);
                      setDuplicateBatchId(id);
                    }}>
                    <Icon name="content-copy" size={16} color="#ffffff" />
                    <Text style={styles.modalDuplicateBtnTxt}>
                      Duplicate Batch
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
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
    marginBottom: 10,
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
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statChip: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.md,
    paddingVertical: 6,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  statLbl: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '700',
    textTransform: 'uppercase',
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
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...SHADOWS.card,
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qrThumbWrap: {
    width: 68,
    height: 68,
    borderRadius: RADIUS.md,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  qrThumb: {
    width: 58,
    height: 58,
  },
  zoomPill: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 8,
    padding: 2,
  },
  infoCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cropName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  statusEmpty: {
    backgroundColor: '#f1f5f9',
  },
  statusFilled: {
    backgroundColor: '#dcfce7',
  },
  statusBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'capitalize',
  },
  productId: {
    fontSize: 13,
    fontWeight: '800', // BOLD font per spec!
    color: '#1a227f',
    fontFamily: 'monospace',
    marginTop: 3,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  locBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,34,127,0.08)',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  locBadgeTxt: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 11,
    color: '#1a227f',
  },
  batchTxt: {
    fontSize: 11,
    color: '#64748b',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  viewQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  viewQrBtnTxt: {
    fontSize: 11.5,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  duplicateBtnTxt: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1a227f',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  qrCardModal: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.lg,
    width: '100%',
    maxWidth: 320,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  labelPreviewContent: {
    alignItems: 'center',
    padding: 20,
  },
  labelPreviewQr: {
    width: 170,
    height: 170,
  },
  labelPreviewCrop: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 10,
  },
  labelPreviewLoc: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a227f',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  labelPreviewId: {
    fontSize: 12,
    fontWeight: '800', // BOLD font per spec!
    color: '#0f172a',
    fontFamily: 'monospace',
    marginTop: 3,
  },
  modalDuplicateBtn: {
    backgroundColor: '#1a227f',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 6,
    marginTop: 16,
    width: '100%',
  },
  modalDuplicateBtnTxt: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
});

