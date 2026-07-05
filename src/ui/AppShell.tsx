// VSCode 風 app shell(ecosystem 共通の見た目): 左 64px sidebar(icon + caption)
// + 右 body(sticky 56px 白 header に breadcrumbs、scrollable content)。
import type { ReactNode } from 'react';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

const SIDEBAR_WIDTH = 64;
const HEADER_HEIGHT = 56;

export interface SidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

function Item({ item, active }: { item: SidebarItem; active: boolean }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={item.onClick}
      data-testid={`sidebar-item-${item.id}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        py: 1,
        width: '100%',
        border: 'none',
        font: 'inherit',
        textDecoration: 'none',
        color: 'primary.contrastText',
        bgcolor: active ? 'primary.dark' : 'transparent',
        borderLeft: '3px solid',
        borderColor: active ? 'primary.contrastText' : 'transparent',
        cursor: 'pointer',
        '&:hover': { bgcolor: active ? 'primary.dark' : 'rgba(255,255,255,0.12)' },
        transition: 'background-color 0.1s',
      }}
    >
      {item.icon}
      <Typography sx={{ fontSize: 10, lineHeight: 1.2, textAlign: 'center' }}>{item.label}</Typography>
    </Box>
  );
}

export function AppShell({
  topItems,
  bottomItems,
  activeItemId,
  breadcrumbs,
  actions,
  children,
}: {
  topItems: SidebarItem[];
  bottomItems: SidebarItem[];
  activeItemId: string;
  breadcrumbs: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.paper' }}>
      <Box
        component="nav"
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 1100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <Stack>
          {topItems.map((i) => (
            <Item key={i.id} item={i} active={i.id === activeItemId} />
          ))}
        </Stack>
        <Stack sx={{ pb: 1 }}>
          {bottomItems.map((i) => (
            <Item key={i.id} item={i} active={i.id === activeItemId} />
          ))}
        </Stack>
      </Box>

      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, ml: `${SIDEBAR_WIDTH}px`, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}
      >
        <Box
          sx={{
            height: HEADER_HEIGHT,
            flexShrink: 0,
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: '0 4px 8px rgba(0,0,0,0.18)',
            px: 2.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Breadcrumbs
            separator={<ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
            aria-label="breadcrumb"
            sx={{ minWidth: 0 }}
          >
            {breadcrumbs.map((label, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <Typography
                  key={label}
                  variant="body1"
                  sx={{
                    color: isLast ? 'text.primary' : 'text.secondary',
                    fontWeight: isLast ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </Typography>
              );
            })}
          </Breadcrumbs>
          {actions}
        </Box>
        <Box sx={{ flexGrow: 1, p: 3, minHeight: 0 }}>{children}</Box>
      </Box>
    </Box>
  );
}
