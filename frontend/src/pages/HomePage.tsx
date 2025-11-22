export default function HomePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Stock Control System</h1>
      <div className="bg-white shadow rounded-lg p-6">
        <p className="text-gray-600">
          This is the dashboard page. The system is configured and ready for development.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-blue-900">Items</h3>
            <p className="text-sm text-blue-700 mt-2">Manage stock items</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-green-900">Locations</h3>
            <p className="text-sm text-green-700 mt-2">Track storage locations</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-purple-900">Movements</h3>
            <p className="text-sm text-purple-700 mt-2">Monitor stock movements</p>
          </div>
        </div>
      </div>
    </div>
  );
}
