module.exports = {
  preset: 'react-native',
  setupFiles: ['@react-native-async-storage/async-storage/jest/async-storage-mock'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@react-navigation|react-redux|immer|redux|@reduxjs)',
  ],
};
