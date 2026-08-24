import React, { useEffect, useState } from 'react';
import { Card, Button } from '@heroui/react';
import { useRouter } from 'next/router';
import { useKeycloak } from '@react-keycloak/web';
import { toast } from 'sonner';

const UserProfilePage: React.FC = () => {
  const { keycloak, initialized } = useKeycloak();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    if (initialized && keycloak?.authenticated) {
      const userInfo = keycloak?.idTokenParsed;
      if (userInfo) {
        setUser({ name: userInfo.name || 'Unknown', email: userInfo.email || 'Unknown' });
      }
    }
  }, [initialized, keycloak]);

  const handleRefreshSession = async () => {
    if (keycloak?.authenticated) {
      try {
        await keycloak.updateToken(70); // Refresh token before it expires
        toast.success('Session refreshed successfully!');
      } catch (error) {
        toast.error('Failed to refresh session. Please log in again.');
        router.push('/login');
      }
    }
  };

  if (!initialized) {
    return <div>Loading...</div>;
  }

  if (!keycloak?.authenticated) {
    return <div>Please log in to view your profile.</div>;
  }

  return (
    <div className="flex justify-center items-center h-screen">
      <Card className="w-full max-w-md p-6 bg-slate-800 text-white shadow-lg rounded-lg">
        <div className="flex flex-col items-center">
          <h1 className="text-2xl font-bold mb-4">User Profile</h1>
          <div className="mb-4">
            <p className="text-lg font-semibold">Name:</p>
            <p className="text-lg">{user?.name}</p>
          </div>
          <div>
            <p className="text-lg font-semibold">Email:</p>
            <p className="text-lg">{user?.email}</p>
          </div>
          <Button
            className="mt-6 bg-slate-600 hover:bg-slate-500 text-white font-semibold"
            onClick={handleRefreshSession}
          >
            Refresh Session
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default UserProfilePage;