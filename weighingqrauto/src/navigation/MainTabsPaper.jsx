import React, {useEffect, useMemo, useState} from 'react';
import {BottomNavigation} from 'react-native-paper';
import {useSelector} from 'react-redux';
import {useRoute} from '@react-navigation/native';
import DashboardScreen from '../screens/DashboardScreen';
import HistoryScreen from '../screens/HistoryScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BatchesScreen from '../screens/BatchesScreen';
import ProductsScreen from '../screens/ProductsScreen';

const BatchesRoute = () => <BatchesScreen />;
const ProductsRoute = () => <ProductsScreen />;
const HomeRoute = () => <DashboardScreen />;
const HistoryRoute = () => <HistoryScreen />;
const AnalyticsRoute = () => <AnalyticsScreen />;
const SettingsRoute = () => <SettingsScreen />;

// Must be defined OUTSIDE the component — SceneMap inside causes infinite re-render loop
const renderScene = BottomNavigation.SceneMap({
  batches: BatchesRoute,
  products: ProductsRoute,
  home: HomeRoute,
  history: HistoryRoute,
  analytics: AnalyticsRoute,
  settings: SettingsRoute,
});

export default function MainTabsPaper() {
  const route = useRoute();
  const {user} = useSelector(s => s.user);

  const isAdmin = Boolean(
    user?.isAdmin || user?.role === 'admin' || user?.role === 'superadmin',
  );

  const adminRoutes = useMemo(
    () => [
      {key: 'batches', title: 'Batches', focusedIcon: 'buffer'},
      {key: 'products', title: 'Products', focusedIcon: 'package-variant-closed'},
      {key: 'home', title: 'Weigh', focusedIcon: 'scale'},
      {key: 'history', title: 'History', focusedIcon: 'history'},
      {key: 'settings', title: 'Settings', focusedIcon: 'cog'},
    ],
    [],
  );

  const operatorRoutes = useMemo(
    () => [
      {key: 'home', title: 'Home', focusedIcon: 'home'},
      {key: 'history', title: 'History', focusedIcon: 'history'},
      {key: 'analytics', title: 'Analytics', focusedIcon: 'chart-line'},
      {key: 'settings', title: 'Settings', focusedIcon: 'cog'},
    ],
    [],
  );

  const routes = isAdmin ? adminRoutes : operatorRoutes;

  const initialIndex = useMemo(() => {
    const tab = route.params?.initialTab;
    if (isAdmin) {
      if (tab === 'products') return 1;
      if (tab === 'home') return 2;
      if (tab === 'history') return 3;
      if (tab === 'settings') return 4;
      return 0; // 'batches' default for admin
    }
    if (tab === 'history') return 1;
    if (tab === 'analytics') return 2;
    if (tab === 'settings') return 3;
    return 0; // 'home'
  }, [isAdmin, route.params]);

  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    const tab = route.params?.initialTab;
    if (isAdmin) {
      if (tab === 'batches') setIndex(0);
      else if (tab === 'products') setIndex(1);
      else if (tab === 'home') setIndex(2);
      else if (tab === 'history') setIndex(3);
      else if (tab === 'settings') setIndex(4);
    } else {
      if (tab === 'history') setIndex(1);
      else if (tab === 'analytics') setIndex(2);
      else if (tab === 'settings') setIndex(3);
      else if (tab === 'home') setIndex(0);
    }
  }, [isAdmin, route.params?.initialTab]);

  return (
    <BottomNavigation
      navigationState={{index, routes}}
      onIndexChange={setIndex}
      renderScene={renderScene}
      shifting={false}
      sceneAnimationEnabled
    />
  );
}
