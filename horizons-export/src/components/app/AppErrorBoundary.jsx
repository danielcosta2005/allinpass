import React from 'react';
import { Button } from '@/components/ui/button';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[app] uncaught render error', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow text-center space-y-4">
            <h1 className="text-xl font-semibold text-gray-900">
              Ocorreu um erro inesperado
            </h1>
            <p className="text-sm text-gray-600">
              Atualize a página para tentar novamente.
            </p>
            <Button onClick={this.handleReload} className="w-full">
              Recarregar página
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
