// orders.css (relevant rules):
//   .orders-table-wrapper { position: relative; overflow-x: auto; max-height: 480px; }
//   .row-menu__list       { position: absolute; right: 0; z-index: 9999; }

import { createContext, memo, useCallback, useContext, useEffect, useState } from 'react';
import { archiveOrder } from './api';
import { debounce } from './utils/debounce'; // standard trailing-edge debounce

type Order = { id: string; customer: string; total: number; status: 'open' | 'shipped' };

type SelectionContextValue = { selectedId: string | null; select: (id: string) => void };
const SelectionContext = createContext<SelectionContextValue>({ selectedId: null, select: () => {} });

export function OrdersPage({ customerId }: { customerId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'total' | 'customer'>('total');
  const [note, setNote] = useState('');

  useEffect(() => {
    fetch(`/api/customers/${customerId}/orders`)
      .then((r) => r.json())
      .then(setOrders);
  }, [customerId]);

  const saveNote = debounce((text: string) => {
    fetch(`/api/customers/${customerId}/note`, { method: 'PUT', body: text });
  }, 500);

  const sorted = [...orders].sort((a, b) =>
    sortBy === 'total' ? b.total - a.total : a.customer.localeCompare(b.customer),
  );

  const OrderRow = ({ order }: { order: Order }) => (
    <tr
      onClick={() => setSelectedId(order.id)}
      className={order.id === selectedId ? 'selected' : undefined}
    >
      <td>{order.customer}</td>
      <td>{order.total}</td>
      <td>{order.status}</td>
      <td>
        <RowMenu orderId={order.id} />
      </td>
    </tr>
  );

  return (
    <SelectionContext.Provider value={{ selectedId, select: setSelectedId }}>
      <textarea
        placeholder="Account note"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          saveNote(e.target.value);
        }}
      />
      <SortToggle value={sortBy} onChange={setSortBy} />
      <div className="orders-table-wrapper">
        <table>
          <tbody>
            {sorted.map((order, index) => (
              <OrderRow key={index} order={order} />
            ))}
          </tbody>
        </table>
      </div>
      <OrderSummaryPanel orders={orders} options={{ currency: 'USD' }} />
      <OrderDetailsDrawer />
    </SelectionContext.Provider>
  );
}

// Renders charts for every order; takes ~60 ms.
const OrderSummaryPanel = memo(function OrderSummaryPanel({
  orders,
  options,
}: {
  orders: Order[];
  options: { currency: string };
}) {
  return <section>{/* charts */}</section>;
});

// Heavy drawer (rich text, attachments) that shows the selected order.
function OrderDetailsDrawer() {
  const { selectedId } = useContext(SelectionContext);
  if (!selectedId) return null;
  return <aside>{/* order details for selectedId */}</aside>;
}

function RowMenu({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <div className="row-menu">
      <button onClick={handleToggle}>⋯</button>
      {open && (
        <ul className="row-menu__list">
          <li>
            <button onClick={() => archiveOrder(orderId)}>Archive</button>
          </li>
        </ul>
      )}
    </div>
  );
}

function SortToggle({ value, onChange }: { value: 'total' | 'customer'; onChange: (v: 'total' | 'customer') => void }) {
  return (
    <button onClick={() => onChange(value === 'total' ? 'customer' : 'total')}>
      Sort by {value === 'total' ? 'customer' : 'total'}
    </button>
  );
}
